import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { StakingRefReward } from '../entities/staking-ref-reward.entity';

@Injectable()
export class StakingRefRewardRepository extends BaseRepository<StakingRefReward> {
  constructor(manager: EntityManager) {
    super(StakingRefReward, manager);
  }
}
