import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, Not } from 'typeorm';

import { StakingReward } from '../entities/staking-reward.entity';
import { StakingRewardRepository } from '../repositories/staking-reward.repository';

import { Util } from 'src/shared/utils/util';
import { CryptoStakingService } from './crypto-staking.service';
import { Config } from 'src/config/config';
import { StakingRepository } from '../repositories/staking.repository';
import { StakingService } from './staking.service';

@Injectable()
export class StakingRewardService {
  constructor(
    private readonly stakingRewardRepo: StakingRewardRepository,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
    private readonly cryptoStakingService: CryptoStakingService,
  ) {}

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.stakingRepo.find().then((l) => l.map((b) => b.id));
    await this.updateRewardVolume(stakingIds);
  }

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return await this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['staking', 'staking.user'],
      order: { id: 'ASC' },
    });
  }

  async getAllUserRewards(userIds: number[]): Promise<StakingReward[]> {
    return await this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } } },
      relations: ['staking', 'staking.user'],
    });
  }

  // --- HELPER METHODS --- //

  private async updateRewardVolume(stakingIds: number[]): Promise<void> {
    stakingIds = stakingIds.filter((u, j) => stakingIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of stakingIds) {
      const { volume } = await this.stakingRewardRepo
        .createQueryBuilder('stakingReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('stakingReward.staking', 'stakingRoute')
        .where('stakingRoute.id = :id', { id: id })
        .getRawOne<{ volume: number }>();

      await this.stakingService.updateRewardVolume(id, volume ?? 0);
    }
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const stakingRewards = await this.stakingRewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
    });

    return stakingRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset,
      payoutType: v.payoutType,
    }));
  }

  public async getYield(): Promise<{ apr: number; apy: number }> {
    const dateTo = new Date();
    dateTo.setUTCHours(0, 0, 0, 0);
    const dateFrom = Util.daysBefore(Config.staking.period, dateTo);

    const { rewardVolume } = await this.stakingRewardRepo
      .createQueryBuilder('stakingReward')
      .select('SUM(outputAmount)', 'rewardVolume')
      .where('stakingReward.outputDate BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo })
      .getRawOne<{ rewardVolume: number }>();

    const balances: number[] = [];
    for (
      const dateIterator = new Date(dateFrom);
      dateIterator < dateTo;
      dateIterator.setDate(dateIterator.getDate() + 1)
    ) {
      balances.push(await this.stakingService.getTotalStakingBalance(dateIterator));
    }

    const apr = await this.getApr(rewardVolume / Config.staking.period, Util.avg(balances));
    return {
      apr: Util.round(apr, 3),
      apy: Util.round(this.getApy(apr), 3),
    };
  }

  private async getApr(interest: number, collateral: number): Promise<number> {
    return (interest / collateral) * 365;
  }

  private getApy(apr: number): number {
    return Math.pow(1 + apr / 365, 365) - 1;
  }
}
