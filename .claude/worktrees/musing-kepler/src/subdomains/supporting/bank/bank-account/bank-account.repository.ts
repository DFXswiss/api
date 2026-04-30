import { Injectable } from '@nestjs/common';
import { CachedRepository } from 'src/shared/repositories/cached.repository';
import { CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { EntityManager } from 'typeorm';
import { BankAccount } from './bank-account.entity';

@Injectable()
export class BankAccountRepository extends CachedRepository<BankAccount> {
  constructor(manager: EntityManager) {
    super(BankAccount, manager, CacheItemResetPeriod.EVERY_24_HOURS);
  }
}
