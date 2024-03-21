import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN });
  }

  async getBlacklist(type?: SpecialExternalAccountType): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({
      type:
        type ??
        In([
          SpecialExternalAccountType.BANNED_IBAN,
          SpecialExternalAccountType.BANNED_BIC,
          SpecialExternalAccountType.BANNED_MAIL,
        ]),
    });
  }
}
