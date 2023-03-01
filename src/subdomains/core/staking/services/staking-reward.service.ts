import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, Not } from 'typeorm';
import { StakingReward } from '../entities/staking-reward.entity';
import { StakingRewardRepository } from '../repositories/staking-reward.repository';

@Injectable()
export class StakingRewardService {
  constructor(private readonly stakingRewardRepo: StakingRewardRepository) {}

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['staking', 'staking.user'],
      order: { id: 'ASC' },
    });
  }
}
