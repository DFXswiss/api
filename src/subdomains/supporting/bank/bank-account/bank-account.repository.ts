import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { BankAccount } from './bank-account.entity';

@Injectable()
export class BankAccountRepository extends BaseRepository<BankAccount> {
  constructor(manager: EntityManager) {
    super(BankAccount, manager);
  }
}
