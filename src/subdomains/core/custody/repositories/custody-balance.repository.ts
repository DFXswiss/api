import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyBalance } from '../entities/custody-balance.entity';

@Injectable()
export class CustodyBalanceRepository extends BaseRepository<CustodyBalance> {
  constructor(manager: EntityManager) {
    super(CustodyBalance, manager);
  }
}
