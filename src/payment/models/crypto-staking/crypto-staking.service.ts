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
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { ReadyCryptoStakingDto } from './dto/ready-crypto-staking.dto';
import { PayoutCryptoStakingDto } from './dto/payout-crypto-staking.dto';
import { GetPayoutsCryptoStakingDto } from './dto/get-payouts-crypto-staking.dto';
import { Between, In, IsNull, LessThan, Not, Raw } from 'typeorm';
import { StakingRewardRepository } from '../staking-reward/staking-reward.respository';
import { StakingBatchDto } from './dto/staking-batch.dto';
import { PayoutType } from '../staking-reward/staking-reward.entity';
import { Util } from 'src/shared/util';
import { StakingRefRewardRepository } from '../staking-ref-reward/staking-ref-reward.repository';
import { StakingRepository } from '../staking/staking.repository';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CryptoStakingService {
  private client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly conversionService: ConversionService,
    private readonly stakingService: StakingService,
    private readonly stakingRewardRepo: StakingRewardRepository,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly stakingRepo: StakingRepository,
  ) {
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
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

    // update staking balance
    await this.stakingService.updateBalance(entity.stakingRoute.id);
  }

  async update(id: number, dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    const entity = await this.cryptoStakingRepo.findOne(id);
    if (!entity) throw new NotFoundException('Crypto staking not found');

    if (entity.outTxId && dto.outputDate != entity.outputDate)
      throw new BadRequestException('Cannot update outputDate if outTxId already set');

    return await this.cryptoStakingRepo.save({ ...entity, ...dto });
  }

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.stakingRepo.find().then((l) => l.map((b) => b.id));

    for (const id of stakingIds) {
      await this.stakingService.updateBalance(id);
    }
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

  async getUserTransactions(userIds: number[]): Promise<CryptoStaking[]> {
    return await this.cryptoStakingRepo.find({
      where: { stakingRoute: { user: { id: In(userIds) } } },
      relations: ['cryptoInput', 'stakingRoute', 'stakingRoute.user'],
    });
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
      .then((l) =>
        l
          .map((b) => ({ ...b, amount: Util.round(b.amount, Config.defaultVolumeDecimal) }))
          .sort((a, b) => (a.outputDate > b.outputDate ? 1 : -1)),
      );
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
      const outputAmountInUsd = await this.client.testCompositeSwap(dto.outputAsset, 'USDT', dto.outputAmount);
      entity.outputAmountInEur = outputAmountInUsd * eurRate;
      entity.outputAmountInChf = outputAmountInUsd * chfRate;

      // check if reinvested
      await this.checkIfReinvested(entity.stakingRoute.id, dto.outTxId);
      if (dto.outTxId2) await this.checkIfReinvested(entity.stakingRoute.id, dto.outTxId2);

      await this.cryptoStakingRepo.save({ ...entity, ...dto });

      // update staking balance
      await this.stakingService.updateBalance(entity.stakingRoute.id);
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

  async getPayoutForecast(date: Date): Promise<{ batches: StakingBatchDto[]; avgInflow: number }> {
    // get future batches
    const batches = await this.cryptoStakingRepo
      .getActiveEntries(date)
      .select('SUM(cryptoStaking.inputAmount)', 'amount')
      .addSelect('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0)', 'outputDate')
      .addSelect('cryptoStaking.payoutType', 'payoutType')
      .orderBy('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0)', 'ASC')
      .groupBy('dateadd(HOUR, datediff(HOUR, 0, cryptoStaking.outputDate), 0), cryptoStaking.payoutType')
      .getRawMany<{ amount: number; outputDate: Date; payoutType: PayoutType }>();

    // get average inflow
    const inflowAvgDays = 14;
    const { inputVolume } = await this.cryptoStakingRepo
      .createQueryBuilder('cryptoStaking')
      .select('SUM(cryptoStaking.inputAmount)', 'inputVolume')
      .where('cryptoStaking.inputDate BETWEEN :from AND :to', { from: Util.daysBefore(inflowAvgDays), to: new Date() })
      .getRawOne<{ inputVolume: number }>();
    const { reinvestVolume } = await this.cryptoStakingRepo
      .createQueryBuilder('cryptoStaking')
      .select('SUM(cryptoStaking.outputAmount)', 'reinvestVolume')
      .where('cryptoStaking.outputDate BETWEEN :from AND :to', { from: Util.daysBefore(inflowAvgDays), to: new Date() })
      .andWhere('cryptoStaking.payoutType = :type', { type: PayoutType.REINVEST })
      .getRawOne<{ reinvestVolume: number }>();

    return { batches, avgInflow: (inputVolume - reinvestVolume) / inflowAvgDays };
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async doRearrange(): Promise<void> {
    const date = Util.daysAfter(Config.staking.period - 1);
    try {
      await this.rearrangeOutputDates(date);
    } catch (e) {
      console.error(`Failed to rearrange staking output dates for ${date}:`, e);
    }
  }

  async rearrangeOutputDates(date: Date, maxBatchSize?: number): Promise<void> {
    date.setUTCHours(0, 0, 0, 0);
    const dateTo = Util.daysAfter(1, date);

    await this.rearrangeReinvests(date, dateTo, maxBatchSize);
    await this.rearrangePaybacks(date, dateTo);
  }

  private async rearrangeReinvests(dateFrom: Date, dateTo: Date, maxBatchSize?: number): Promise<void> {
    // all reinvests of that day
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: {
        outputDate: Raw((d) => `${d} >= :from AND ${d} < :to`, { from: dateFrom, to: dateTo }),
        outTxId: IsNull(),
        payoutType: PayoutType.REINVEST,
      },
      order: { stakingRoute: 'ASC' },
    });

    if (!maxBatchSize) {
      // find optimal batch size
      const totalVolume = Util.sumObj(cryptoStakingList, 'inputAmount');
      maxBatchSize = Math.min(totalVolume / 20, 20000);
    }

    const payoutDate = new Date(dateFrom);
    while (cryptoStakingList.length > 0) {
      if (payoutDate >= dateTo) throw new InternalServerErrorException('Not enough time to payback staking reinvests');

      // aggregate to batches
      const batch: CryptoStaking[] = [];
      let batchAmount = 0;

      while (
        cryptoStakingList.length > 0 &&
        (batchAmount === 0 || batchAmount + cryptoStakingList[0].inputAmount <= maxBatchSize)
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
        payoutType: PayoutType.WALLET,
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
      inTxId: e.inTxId,
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
        where: [
          { outTxId: cryptoInput.inTxId, stakingRoute: { id: cryptoInput.route.id } },
          { outTxId2: cryptoInput.inTxId, stakingRoute: { id: cryptoInput.route.id } },
        ],
      })) != null ||
      (await this.stakingRewardRepo.findOne({ txId: cryptoInput.inTxId, staking: { id: cryptoInput.route.id } })) !=
        null ||
      (await this.stakingRefRewardRepo.findOne({ txId: cryptoInput.inTxId, staking: { id: cryptoInput.route.id } })) !=
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
