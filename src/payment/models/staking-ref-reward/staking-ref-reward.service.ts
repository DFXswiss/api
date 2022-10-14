import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, Not } from 'typeorm';
import { StakingRefRewardRepository } from './staking-ref-reward.repository';
import { StakingRefReward, StakingRefType } from './staking-ref-reward.entity';
import { UserService } from 'src/user/models/user/user.service';
import { Interval } from '@nestjs/schedule';
import { User } from 'src/user/models/user/user.entity';
import { Config } from 'src/config/config';
import { Staking } from '../staking/staking.entity';
import { ConversionService } from 'src/shared/services/conversion.service';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { PricingService } from '../pricing/services/pricing.service';
import { DeFiClient } from 'src/blockchain/ain/node/defi-client';
import { NotificationService } from 'src/notification/services/notification.service';
import { MailType } from 'src/notification/enums';
import { PriceRequestContext } from '../pricing/enums';

@Injectable()
export class StakingRefRewardService {
  private client: DeFiClient;

  constructor(
    nodeService: NodeService,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly userService: UserService,
    private readonly conversionService: ConversionService,
    private readonly pricingService: PricingService,
    private readonly notificationService: NotificationService,
  ) {
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.client = client));
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
        const priceRequest = this.createPriceRequest(openRewards);
        const { price } = await this.pricingService.getPrice(priceRequest).catch((e) => {
          console.error('Failed to get price:', e);
          throw e;
        });

        for (const reward of openRewards) {
          try {
            await this.sendReward(reward, price.price);
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
    const txId = await this.client.sendUtxoToMany([{ addressTo: address, amount: rewardInDfi }]);

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
      const sentRewards = await this.stakingRefRewardRepo.find({
        where: { txId: Not(IsNull()), mailSendDate: IsNull() },
        relations: ['user', 'user.userData', 'user.userData.language'],
      });

      const confirmedRewards = await this.getConfirmedRewards(sentRewards);

      for (const reward of confirmedRewards) {
        try {
          if (reward.user.userData.mail) {
            await this.notificationService.sendMail({
              type: MailType.USER,
              input: {
                userData: reward.user.userData,
                translationKey: `mail.stakingRef.${reward.stakingRefType.toString().toLowerCase()}`,
                translationParams: {
                  txId: reward.txId,
                  outputAmount: reward.outputAmount,
                  outputAsset: reward.outputAsset,
                },
              },
            });
          } else {
            console.error(`Failed to send staking ref reward mail ${reward.id}: user has no email`);
          }

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

  private async getConfirmedRewards(sentRewards: StakingRefReward[]): Promise<StakingRefReward[]> {
    const confirmedRewards = [];

    for (const reward of sentRewards) {
      const chainTx = await this.client.getTx(reward.txId);

      if (chainTx.blockhash && chainTx.confirmations > 0) {
        confirmedRewards.push(reward);
      }
    }

    return confirmedRewards;
  }

  private createPriceRequest(openRewards: StakingRefReward[]) {
    const correlationId = 'StakingRefRewards&' + openRewards.reduce((acc, r) => acc + `|${r.id}|`, '');
    return { context: PriceRequestContext.STAKING_REWARD, correlationId, from: 'EUR', to: 'BTC' };
  }
}
