import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { Staking } from '../entities/staking.entity';

@Injectable()
export class StakingRepository extends BaseRepository<Staking> {
  constructor(manager: EntityManager) {
    super(Staking, manager);
  }
}
