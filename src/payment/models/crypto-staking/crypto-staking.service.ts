import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { Between, IsNull, LessThan } from 'typeorm';
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

    entity.outputDate = new Date(cryptoInput.created);
    entity.outputDate.setDate(entity.outputDate.getDate() + Config.staking.period);
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
        { stakingRoute: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo), isReinvest: false },
      ],
      relations: ['cryptoInput', 'stakingRoute', 'stakingRoute.user'],
    });

    return {
      deposits: cryptoStaking.filter((entry) => entry.inputDate >= dateFrom && entry.inputDate <= dateTo),
      withdrawals: cryptoStaking.filter(
        (entry) => entry.outTxId && entry.outputDate >= dateFrom && entry.outputDate <= dateTo,
      ),
    };
  }

  async getActiveBatches(userId: number, stakingId: number): Promise<StakingBatchDto[]> {
    return await this.cryptoStakingRepo
      .getActiveEntries(new Date())
      .leftJoin('cryptoStaking.stakingRoute', 'stakingRoute')
      .andWhere('cryptoStaking.stakingRouteId = :stakingId', { stakingId })
      .andWhere('stakingRoute.userId = :userId', { userId })
      .getMany()
      .then(this.toBatchDtoList);
  }

  // --- MASTERNODE OPERATOR --- //
  async payout(dtoList: PayoutCryptoStakingDto[]): Promise<void> {
    for (const dto of dtoList) {
      const entity = await this.cryptoStakingRepo.findOne(dto.id, { relations: ['stakingRoute'] });
      if (!entity) throw new NotFoundException('Crypto staking not found');

      const outputAmountInUsd = await this.client.testCompositeSwap(
        Config.node.utxoSpenderAddress,
        dto.outputAsset,
        'USDT',
        dto.outputAmount,
      );
      [entity.outputAmountInEur, entity.outputAmountInChf] = await Promise.all([
        this.conversionService.convertFiat(outputAmountInUsd, 'usd', 'eur'),
        this.conversionService.convertFiat(outputAmountInUsd, 'usd', 'chf'),
      ]);

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
    return this.toPayoutDtoList(cryptoStakingList);
  }

  async getPendingPayouts(date: Date): Promise<GetPayoutsCryptoStakingDto[]> {
    date.setHours(date.getHours() + 1, 0, 0, 0);
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: { readyToPayout: false, outputDate: LessThan(date) },
      relations: ['stakingRoute', 'stakingRoute.paybackAsset', 'stakingRoute.user'],
    });
    return this.toPayoutDtoList(cryptoStakingList);
  }

  // --- DTO --- //
  private toPayoutDtoList(cryptoStakingList: CryptoStaking[]): GetPayoutsCryptoStakingDto[] {
    return cryptoStakingList.map((e) => ({
      id: e.id,
      address: e.paybackDeposit?.address ?? e.stakingRoute.user.address,
      outputAsset: e.stakingRoute.paybackAsset?.dexName,
      amount: e.inputAmount,
      payoutType: e.payoutType,
    }));
  }

  private toBatchDtoList(cryptoStakingList: CryptoStaking[]): StakingBatchDto[] {
    const batches = cryptoStakingList.map((c) => ({
      amount: c.inputAmount,
      outputDate: Util.getUtcDay(c.outputDate).toISOString(),
      payoutType: c.payoutType,
    }));

    const aggregateBatches = Object.values(PayoutType).reduce(
      (prev, curr) => ({
        ...prev,
        [curr]: Util.aggregate(
          batches.filter((c) => c.payoutType === curr),
          'outputDate',
          'amount',
        ),
      }),
      {},
    );

    return Object.entries(aggregateBatches)
      .map(([type, batch]) =>
        Object.entries(batch).map(([date, amount]) => ({
          amount,
          outputDate: new Date(date),
          payoutType: type as PayoutType,
        })),
      )
      .reduce((prev, curr) => prev.concat(curr), []);
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
