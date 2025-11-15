import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { EntityManager } from 'typeorm';
import { BankAccount } from './bank-account.entity';

@Injectable()
export class BankAccountRepository extends CachedRepository<BankAccount> {
  constructor(manager: EntityManager) {
    super(BankAccount, manager);
  }
}
