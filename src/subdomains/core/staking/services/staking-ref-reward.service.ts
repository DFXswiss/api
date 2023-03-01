import { Injectable } from '@nestjs/common';
import { Between, In, IsNull, Not } from 'typeorm';
import { StakingRefRewardRepository } from '../repositories/staking-ref-reward.repository';
import { StakingRefReward } from '../entities/staking-ref-reward.entity';

@Injectable()
export class StakingRefRewardService {
  constructor(private readonly stakingRefRewardRepo: StakingRefRewardRepository) {}

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingRefReward[]> {
    return this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['user'],
    });
  }
}
