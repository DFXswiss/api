import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { RefReward } from './ref-reward.entity';

@Injectable()
export class RefRewardRepository extends BaseRepository<RefReward> {
  constructor(manager: EntityManager) {
    super(RefReward, manager);
  }
}
