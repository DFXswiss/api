import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  private readonly cache = new AsyncCache<SpecialExternalAccount[]>(CacheItemResetPeriod.EVERY_5_MINUTE);

  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalAccount[]> {
    return this.cache.get(`MultiAccountIbans`, () =>
      this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN }),
    );
  }

  async getBlacklist(type?: SpecialExternalAccountType): Promise<SpecialExternalAccount[]> {
    return this.cache.get(`Blacklist`, () =>
      this.specialExternalAccountRepo.findBy({
        type:
          type ??
          In([
            SpecialExternalAccountType.BANNED_IBAN,
            SpecialExternalAccountType.BANNED_BIC,
            SpecialExternalAccountType.BANNED_MAIL,
          ]),
      }),
    );
  }
}
