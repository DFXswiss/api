import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { StakingReward } from '../entities/staking-reward.entity';

@Injectable()
export class StakingRewardRepository extends BaseRepository<StakingReward> {
  constructor(manager: EntityManager) {
    super(StakingReward, manager);
  }
}
