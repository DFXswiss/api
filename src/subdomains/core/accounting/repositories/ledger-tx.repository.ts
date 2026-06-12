import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LedgerTx } from '../entities/ledger-tx.entity';

@Injectable()
export class LedgerTxRepository extends BaseRepository<LedgerTx> {
  constructor(manager: EntityManager) {
    super(LedgerTx, manager);
  }
}
