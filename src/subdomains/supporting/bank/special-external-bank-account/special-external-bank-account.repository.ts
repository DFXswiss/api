import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { SpecialExternalBankAccount } from './special-external-bank-account.entity';

@Injectable()
export class SpecialExternalBankAccountRepository extends BaseRepository<SpecialExternalBankAccount> {
  constructor(manager: EntityManager) {
    super(SpecialExternalBankAccount, manager);
  }
}
