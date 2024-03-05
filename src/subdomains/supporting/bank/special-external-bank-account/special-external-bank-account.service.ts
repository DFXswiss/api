import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { SpecialExternalBankAccount, SpecialExternalBankAccountType } from './special-external-bank-account.entity';
import { SpecialExternalBankAccountRepository } from './special-external-bank-account.repository';

@Injectable()
export class SpecialExternalBankAccountService {
  constructor(private readonly specialExternalIbanRepo: SpecialExternalBankAccountRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalBankAccount[]> {
    return this.specialExternalIbanRepo.findBy({ type: SpecialExternalBankAccountType.MULTI_ACCOUNT_IBAN });
  }

  async getBlacklist(): Promise<SpecialExternalBankAccount[]> {
    return this.specialExternalIbanRepo.findBy({
      type: In([SpecialExternalBankAccountType.BANNED_IBAN, SpecialExternalBankAccountType.BANNED_BIC]),
    });
  }
}
