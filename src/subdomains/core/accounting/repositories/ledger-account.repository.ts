import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LedgerAccount } from '../entities/ledger-account.entity';

@Injectable()
export class LedgerAccountRepository extends BaseRepository<LedgerAccount> {
  constructor(manager: EntityManager) {
    super(LedgerAccount, manager);
  }
}
