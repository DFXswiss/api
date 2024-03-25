import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  private readonly arrayCache = new AsyncCache<SpecialExternalAccount[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccountIbans(): Promise<SpecialExternalAccount[]> {
    return this.arrayCache.get(`MultiAccountIbans`, () =>
      this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN }),
    );
  }

  async getBlacklist(type?: SpecialExternalAccountType): Promise<SpecialExternalAccount[]> {
    return this.arrayCache.get(`Blacklist`, () =>
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
