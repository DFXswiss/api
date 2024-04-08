import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccounts(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN });
  }

  async getMultiAccountIbans(): Promise<string[]> {
    return this.getMultiAccounts().then((list) => list.map((a) => a.value));
  }

  async getBlacklist(types?: SpecialExternalAccountType[]): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findBy({
      type: In(
        types ?? [
          SpecialExternalAccountType.BANNED_IBAN,
          SpecialExternalAccountType.BANNED_IBAN_BUY,
          SpecialExternalAccountType.BANNED_IBAN_SELL,
          SpecialExternalAccountType.BANNED_BIC,
          SpecialExternalAccountType.BANNED_MAIL,
        ],
      ),
    });
  }
}
