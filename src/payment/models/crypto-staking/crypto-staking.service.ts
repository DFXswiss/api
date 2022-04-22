import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { ConversionService } from 'src/shared/services/conversion.service';
import { CryptoInput } from '../crypto-input/crypto-input.entity';
import { Staking } from '../staking/staking.entity';
import { StakingService } from '../staking/staking.service';
import { CryptoStaking } from './crypto-staking.entity';
import { CryptoStakingRepository } from './crypto-staking.repository';
import { UpdateCryptoStakingDto } from './dto/update-crypto-staking.dto';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { ReadyCryptoStakingDto } from './dto/ready-crypto-staking.dto';
import { PayoutCryptoStakingDto } from './dto/payout-crypto-staking.dto';
import { GetPayoutsCryptoStakingDto } from './dto/get-payouts-crypto-staking.dto';
import { Between, IsNull, LessThan, Not, Raw } from 'typeorm';
import { StakingRewardRepository } from '../staking-reward/staking-reward.respository';
import { StakingBatchDto } from './dto/staking-batch.dto';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { Util } from 'src/shared/util';

@Injectable()
export class CryptoStakingService {
  private readonly client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly conversionService: ConversionService,
    private readonly stakingService: StakingService,
    private readonly stakingRewardRepo: StakingRewardRepository,
  ) {
    this.client = nodeService.getClient(NodeType.INPUT, NodeMode.ACTIVE);
  }

  // --- CRUD --- //
  async create(cryptoInput: CryptoInput): Promise<void> {
    const entity = this.cryptoStakingRepo.create();

    entity.cryptoInput = cryptoInput;
    entity.inTxId = cryptoInput.inTxId;
    entity.inputDate = cryptoInput.created;
    entity.inputAsset = cryptoInput.asset.dexName;
    entity.inputAmount = cryptoInput.amount;
    entity.inputAmountInEur = await this.conversionService.convertFiat(
      cryptoInput.usdtAmount,
      'usd',
      'eur',
      cryptoInput.created,
    );
    entity.inputAmountInChf = await this.conversionService.convertFiat(
      cryptoInput.usdtAmount,
      'usd',
      'chf',
      cryptoInput.created,
    );

    entity.stakingRoute = cryptoInput.route as Staking;
    entity.payoutType = this.stakingService.getPayoutType(
      entity.stakingRoute.paybackDeposit?.id,
      entity.stakingRoute.deposit.id,
    );
    entity.paybackDeposit = entity.stakingRoute.paybackDeposit;

    entity.outputDate = Util.daysAfter(Config.staking.period, cryptoInput.created);
    entity.isReinvest = await this.isReinvest(cryptoInput);

    await this.cryptoStakingRepo.save(entity);
  }

  async update(id: number, dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    const entity = await this.cryptoStakingRepo.findOne(id);
    if (!entity) throw new NotFoundException('Crypto staking not found');

    if (entity.outTxId && dto.outputDate != entity.outputDate)
      throw new BadRequestException('Cannot update outputDate if outTxId already set');

    return await this.cryptoStakingRepo.save({ ...entity, ...dto });
  }

  // --- USER --- //
  async getUserInvests(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ deposits: CryptoStaking[]; withdrawals: CryptoStaking[] }> {
    const cryptoStaking = await this.cryptoStakingRepo.find({
      where: [
        { stakingRoute: { user: { id: userId } }, inputDate: Between(dateFrom, dateTo), isReinvest: false },
        {
          stakingRoute: { user: { id: userId } },
          outputDate: Between(dateFrom, dateTo),
          payoutType: Not(PayoutType.REINVEST),
        },
      ],
      relations: ['cryptoInput', 'stakingRoute', 'stakingRoute.user'],
    });

    return {
      deposits: cryptoStaking.filter(
        (entry) => entry.inputDate >= dateFrom && entry.inputDate <= dateTo && !entry.isReinvest,
      ),
      withdrawals: cryptoStaking.filter(
        (entry) =>
          entry.outTxId &&
          entry.outputDate >= dateFrom &&
          entry.outputDate <= dateTo &&
          entry.payoutType !== PayoutType.REINVEST,
      ),
    };
  }

  async getActiveBatches(userId: number, stakingId: number): Promise<StakingBatchDto[]> {
    return await this.cryptoStakingRepo
      .getActiveEntries()
      .select('SUM(cryptoStaking.inputAmount)', 'amount')
      .addSelect('dateadd(DAY, datediff(DAY, 0, cryptoStaking.outputDate), 0)', 'outputDate')
      .addSelect('cryptoStaking.payoutType', 'payoutType')
      .leftJoin('cryptoStaking.stakingRoute', 'stakingRoute')
      .andWhere('stakingRoute.id = :stakingId', { stakingId })
      .andWhere('stakingRoute.userId = :userId', { userId })
      .groupBy('dateadd(DAY, datediff(DAY, 0, cryptoStaking.outputDate), 0), cryptoStaking.payoutType')
      .getRawMany<{ amount: number; outputDate: Date; payoutType: PayoutType }>()
      .then((l) => l.map((b) => ({ ...b, amount: Util.round(b.amount, 2) })));
  }

  // --- MASTERNODE OPERATOR --- //
  async payout(dtoList: PayoutCryptoStakingDto[]): Promise<void> {
    const [eurRate, chfRate] = await Promise.all([
      this.conversionService.getFiatRate('usd', 'eur'),
      this.conversionService.getFiatRate('usd', 'chf'),
    ]);

    for (const dto of dtoList) {
      const entity = await this.cryptoStakingRepo.findOne(dto.id, { relations: ['stakingRoute'] });
      if (!entity) throw new NotFoundException('Crypto staking not found');

      // amount in fiat
      const outputAmountInUsd = await this.client.testCompositeSwap(
        Config.node.utxoSpenderAddress,
        dto.outputAsset,
        'USDT',
        dto.outputAmount,
      );
      entity.outputAmountInEur = outputAmountInUsd * eurRate;
      entity.outputAmountInChf = outputAmountInUsd * chfRate;

      // check if reinvested
      await this.checkIfReinvested(entity.stakingRoute.id, dto.outTxId);

      await this.cryptoStakingRepo.save({ ...entity, ...dto });
    }
  }

  async ready(dto: ReadyCryptoStakingDto): Promise<void> {
    await this.cryptoStakingRepo.update(dto.ids, { readyToPayout: true });
  }

  async getReadyPayouts(): Promise<GetPayoutsCryptoStakingDto[]> {
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: { readyToPayout: true, outTxId: IsNull() },
      relations: ['stakingRoute', 'stakingRoute.paybackAsset', 'stakingRoute.user'],
    });
    return this.toDtoList(cryptoStakingList);
  }

  async getPendingPayouts(date: Date): Promise<GetPayoutsCryptoStakingDto[]> {
    date.setHours(date.getHours() + 1, 0, 0, 0);
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: { readyToPayout: false, outputDate: LessThan(date) },
      relations: ['stakingRoute', 'stakingRoute.paybackAsset', 'stakingRoute.user'],
    });
    return this.toDtoList(cryptoStakingList);
  }

  async getPayoutForecast(): Promise<{ batches: StakingBatchDto[]; avgInflow: number }> {
    const batches = await this.cryptoStakingRepo
      .getActiveEntries()
      .select('SUM(cryptoStaking.inputAmount)', 'amount')
      .addSelect('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0)', 'outputDate')
      .addSelect('cryptoStaking.payoutType', 'payoutType')
      .orderBy('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0)', 'ASC')
      .groupBy('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0), cryptoStaking.payoutType')
      .getRawMany<{ amount: number; outputDate: Date; payoutType: PayoutType }>();

    const balanceToday = await this.stakingService.getTotalStakingBalance();
    const balanceLastWeek = await this.stakingService.getTotalStakingBalance(Util.daysBefore(7));

    return { batches, avgInflow: (balanceToday - balanceLastWeek) / 7 };
  }

  async rearrangeOutputDates(date: Date): Promise<void> {
    date.setUTCHours(0, 0, 0, 0);
    const dateTo = Util.daysAfter(1, date);

    await this.rearrangeReinvests(date, dateTo);
    await this.rearrangePaybacks(date, dateTo);
  }

  private async rearrangeReinvests(dateFrom: Date, dateTo: Date): Promise<void> {
    // all reinvests of that day
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: {
        outputDate: Raw((d) => `${d} >= :from AND ${d} < :to`, { from: dateFrom, to: dateTo }),
        outTxId: IsNull(),
        payoutType: PayoutType.REINVEST,
      },
      order: { stakingRoute: 'ASC' },
    });

    const payoutDate = new Date(dateFrom);
    while (cryptoStakingList.length > 0) {
      if (payoutDate >= dateTo) throw new InternalServerErrorException('Not enough time to payback staking reinvests');

      // aggregate to batches
      const batch: CryptoStaking[] = [];
      let batchAmount = 0;

      while (
        cryptoStakingList.length > 0 &&
        (batchAmount === 0 || batchAmount + cryptoStakingList[0].inputAmount <= Config.staking.payoutBatchSize)
      ) {
        batchAmount += cryptoStakingList[0].inputAmount;
        batch.push(cryptoStakingList.shift());
      }

      // update output date
      await this.cryptoStakingRepo.update(
        batch.map((c) => c.id),
        { outputDate: payoutDate },
      );
      payoutDate.setHours(payoutDate.getHours() + 1);
    }
  }

  private async rearrangePaybacks(dateFrom: Date, dateTo: Date): Promise<void> {
    const deadline = new Date(dateFrom);
    deadline.setUTCHours(10);

    // all paybacks after the deadline
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: {
        outputDate: Raw((d) => `${d} >= :from AND ${d} < :to`, { from: deadline, to: dateTo }),
        outTxId: IsNull(),
        payoutType: Not(PayoutType.REINVEST),
      },
    });

    // update output date
    if (cryptoStakingList.length > 0) {
      await this.cryptoStakingRepo.update(
        cryptoStakingList.map((c) => c.id),
        { outputDate: deadline },
      );
    }
  }

  // --- DTO --- //
  private toDtoList(cryptoStakingList: CryptoStaking[]): GetPayoutsCryptoStakingDto[] {
    return cryptoStakingList.map((e) => ({
      id: e.id,
      address: e.paybackDeposit?.address ?? e.stakingRoute.user.address,
      outputAsset: e.stakingRoute.paybackAsset?.dexName,
      amount: e.inputAmount,
      payoutType: e.payoutType,
    }));
  }

  // --- HELPER METHODS --- //
  private async isReinvest(cryptoInput: CryptoInput): Promise<boolean> {
    return (
      (await this.cryptoStakingRepo.findOne({
        outTxId: cryptoInput.inTxId,
        stakingRoute: { id: cryptoInput.route.id },
      })) != null ||
      (await this.stakingRewardRepo.findOne({ txId: cryptoInput.inTxId, staking: { id: cryptoInput.route.id } })) !=
        null
    );
  }

  async checkIfReinvested(stakingId: number, txId: string): Promise<void> {
    const reinvest = await this.cryptoStakingRepo.findOne({
      inTxId: txId,
      stakingRoute: { id: stakingId },
    });
    if (reinvest) {
      await this.cryptoStakingRepo.update(reinvest.id, { isReinvest: true });
    }
  }
}
