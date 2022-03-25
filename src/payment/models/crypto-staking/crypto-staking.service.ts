import { Injectable, NotFoundException } from '@nestjs/common';
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

    // TODO: uncomment
    //entity.outputDate = new Date(cryptoInput.created);
    //entity.outputDate.setDate(entity.outputDate.getDate() + Config.staking.period);
    entity.outputDate = new Date('2022-03-31');
    entity.isReinvest = await this.isReinvest(cryptoInput);

    await this.cryptoStakingRepo.save(entity);
  }

  async update(id: number, dto: UpdateCryptoStakingDto): Promise<CryptoStaking> {
    const entity = await this.cryptoStakingRepo.findOne(id);
    if (!entity) throw new NotFoundException('Crypto staking not found');

    return await this.cryptoStakingRepo.save({ ...entity, ...dto });
  }

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

      entity.isReinvest =
        (await this.cryptoStakingRepo.findOne({
          inTxId: dto.outTxId,
          stakingRoute: { id: entity.stakingRoute.id },
        })) != null;

      await this.cryptoStakingRepo.save({ ...entity, ...dto });
    }
  }

  async ready(dto: ReadyCryptoStakingDto): Promise<void> {
    await this.cryptoStakingRepo.update(dto.ids, { readyToPayout: true });
  }

  async getReadyPayouts(): Promise<GetPayoutsCryptoStakingDto[]> {
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: { readyToPayout: true, outTxId: IsNull() },
      relations: ['stakingRoute', 'stakingRoute.paybackDeposit', 'stakingRoute.paybackAsset', 'stakingRoute.user'],
    });
    return this.toDtoList(cryptoStakingList);
  }

  async getPendingPayouts(date: Date): Promise<GetPayoutsCryptoStakingDto[]> {
    date.setHours(date.getHours() + 1, 0, 0, 0);
    const cryptoStakingList = await this.cryptoStakingRepo.find({
      where: { readyToPayout: false, outputDate: LessThan(date) },
      relations: ['stakingRoute', 'stakingRoute.paybackDeposit', 'stakingRoute.paybackAsset', 'stakingRoute.user'],
    });
    return this.toDtoList(cryptoStakingList);
  }

  private toDtoList(cryptoStakingList: CryptoStaking[]): GetPayoutsCryptoStakingDto[] {
    return cryptoStakingList.map((e) => ({
      id: e.id,
      address: e.stakingRoute.paybackDeposit?.address ?? e.stakingRoute.user.address,
      outputAsset: e.stakingRoute.paybackAsset?.dexName,
      amount: e.inputAmount,
      payoutType: this.stakingService.getPayoutType(e.stakingRoute.paybackDeposit?.id, e.stakingRoute.deposit.id),
    }));
  }

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
}
