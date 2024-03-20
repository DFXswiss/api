import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from './special-external-account.entity';
import { SpecialExternalAccountRepository } from './special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN });
  }

  async getBlacklist(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({
      type: In([
        SpecialExternalAccountType.BANNED_IBAN,
        SpecialExternalAccountType.BANNED_BIC,
        SpecialExternalAccountType.BANNED_MAIL,
      ]),
    });
  }
}
