import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, Not } from 'typeorm';
import { StakingRefRewardRepository } from './staking-ref-reward.repository';
import { StakingRefReward, StakingRefType } from './staking-ref-reward.entity';
import { UserService } from 'src/user/models/user/user.service';
import { Interval } from '@nestjs/schedule';
import { MailService } from 'src/shared/services/mail.service';
import { User } from 'src/user/models/user/user.entity';
import { Config } from 'src/config/config';
import { Staking } from '../staking/staking.entity';
import { ConversionService } from 'src/shared/services/conversion.service';
import { KrakenService } from '../exchange/kraken.service';
import { BinanceService } from '../exchange/binance.service';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { NodeClient } from 'src/ain/node/node-client';

@Injectable()
export class StakingRefRewardService {
  private readonly client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly userService: UserService,
    private readonly conversionService: ConversionService,
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly mailService: MailService,
  ) {
    this.client = nodeService.getClient(NodeType.REF, NodeMode.ACTIVE);
  }

  async create(staking: Staking): Promise<void> {
    if (!staking.user) throw new Error('User is null');
    if (staking.user.created < Config.staking.refSystemStart || staking.user.usedRef === '000-000') return;

    const refUser = await this.userService.getRefUser(staking.user.usedRef);
    if (!refUser) return;

    const entities = [await this.createEntity(staking.user, staking), await this.createEntity(refUser)];
    await this.stakingRefRewardRepo.save(entities);
  }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updatePaidStakingRefCredit(userIds);
  }

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingRefReward[]> {
    return await this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['user'],
    });
  }

  async getAllUserRewards(userIds: number[]): Promise<StakingRefReward[]> {
    return await this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ['user'],
    });
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const refRewards = await this.stakingRefRewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
    });

    return refRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset,
    }));
  }

  // --- Tasks --- //
  @Interval(900000)
  async doTasks(): Promise<void> {
    await this.sendRewards();
    await this.sendMails();
  }

  private async sendRewards(): Promise<void> {
    try {
      const openRewards = await this.stakingRefRewardRepo.find({
        where: { txId: IsNull() },
        relations: ['user', 'staking', 'staking.deposit'],
      });

      if (openRewards.length > 0) {
        const { price: krakenPrice } = await this.krakenService.getPrice('EUR', 'BTC');
        const { price: binancePrice } = await this.binanceService.getPrice('EUR', 'BTC');
        if (Math.abs(binancePrice - krakenPrice) / krakenPrice > 0.02)
          throw new Error(`BTC price mismatch (kraken: ${krakenPrice}, binance: ${binancePrice})`);

        for (const reward of openRewards) {
          try {
            await this.sendReward(reward, krakenPrice);
          } catch (e) {
            console.error(`Failed to send staking ref reward ${reward.id}:`, e);
          }
        }
      }
    } catch (e) {
      console.error('Exception during staking ref reward send:', e);
    }
  }

  private async sendReward(reward: StakingRefReward, btcPrice: number): Promise<void> {
    const rewardInBtc = reward.inputReferenceAmount / btcPrice;
    const rewardInDfi = await this.client.testCompositeSwap('BTC', 'DFI', rewardInBtc);

    const address =
      reward.stakingRefType === StakingRefType.REFERRED ? reward.staking.deposit.address : reward.user.address;
    const txId = await this.client.sendMany({ [address]: rewardInDfi });

    const update = {
      outputReferenceAmount: rewardInBtc,
      outputReferenceAsset: 'BTC',
      outputAmount: rewardInDfi,
      outputAsset: 'DFI',
      txId: txId,
      outputDate: new Date(),
    };
    await this.stakingRefRewardRepo.update(reward.id, update);
    await this.updatePaidStakingRefCredit([reward.user.id]);
  }

  private async sendMails(): Promise<void> {
    try {
      const openRewardMails = await this.stakingRefRewardRepo.find({
        where: { txId: Not(IsNull()), mailSendDate: IsNull() },
        relations: ['user', 'user.userData', 'user.userData.language'],
      });

      for (const reward of openRewardMails) {
        try {
          await this.mailService.sendStakingRefMail(
            reward.user.userData.mail,
            reward.user.userData.language.symbol,
            reward.stakingRefType,
          );

          const update = {
            mailSendDate: new Date().getTime(),
            recipientMail: reward.user.userData.mail,
          };
          await this.stakingRefRewardRepo.update(reward.id, update);
        } catch (e) {
          console.error(`Failed to send staking ref reward mail ${reward.id}:`, e);
        }
      }
    } catch (e) {
      console.error('Exception during staking ref reward mail send:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async createEntity(user: User, staking?: Staking): Promise<StakingRefReward> {
    return this.stakingRefRewardRepo.create({
      user: user,
      staking: staking,
      stakingRefType: staking ? StakingRefType.REFERRED : StakingRefType.REFERRER,
      inputAmount: Config.staking.refReward,
      inputAsset: 'EUR',
      inputReferenceAmount: Config.staking.refReward,
      inputReferenceAsset: 'EUR',
      amountInChf: await this.conversionService.convertFiat(Config.staking.refReward, 'EUR', 'CHF'),
      amountInEur: Config.staking.refReward,
    });
  }

  private async updatePaidStakingRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.stakingRefRewardRepo
        .createQueryBuilder('stakingRefReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('stakingRefReward.user', 'user')
        .where('user.id = :id', { id })
        .andWhere('txId IS NOT NULL')
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidStakingRefCredit(id, volume ?? 0);
    }
  }
}
