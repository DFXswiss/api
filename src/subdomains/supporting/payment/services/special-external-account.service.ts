import { Injectable } from '@nestjs/common';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { In } from 'typeorm';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  private readonly arrayCache = new AsyncCache<SpecialExternalAccount[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async getMultiAccounts(): Promise<SpecialExternalAccount[]> {
    return this.arrayCache.get(`MultiAccountIbans`, () =>
      this.specialExternalAccountRepo.findBy({ type: SpecialExternalAccountType.MULTI_ACCOUNT_IBAN }),
    );
  }

  async getMultiAccountIbans(): Promise<string[]> {
    return this.getMultiAccounts().then((list) => list.map((a) => a.value));
  }

  async getBlacklist(types?: SpecialExternalAccountType[]): Promise<SpecialExternalAccount[]> {
    return this.arrayCache.get(`Blacklist-${types?.toString()}`, () =>
      this.specialExternalAccountRepo.findBy({
        type: In(
          types ?? [
            SpecialExternalAccountType.BANNED_IBAN,
            SpecialExternalAccountType.BANNED_IBAN_BUY,
            SpecialExternalAccountType.BANNED_IBAN_SELL,
            SpecialExternalAccountType.BANNED_BIC,
            SpecialExternalAccountType.BANNED_MAIL,
          ],
        ),
      }),
    );
  }
}
