import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CryptoStaking } from '../entities/crypto-staking.entity';

@Injectable()
export class CryptoStakingRepository extends BaseRepository<CryptoStaking> {
  constructor(manager: EntityManager) {
    super(CryptoStaking, manager);
  }
}
