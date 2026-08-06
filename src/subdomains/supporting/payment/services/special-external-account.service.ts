import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { CreateSpecialExternalAccountDto } from '../dto/input/create-special-external-account.dto';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async createSpecialExternalAccount(dto: CreateSpecialExternalAccountDto): Promise<SpecialExternalAccount> {
    const existing = await this.specialExternalAccountRepo.findOneBy({
      type: dto.type,
      value: dto.value,
    });
    if (existing) throw new BadRequestException('Special external account already created');

    const specialExternalAccount = this.specialExternalAccountRepo.create(dto);

    return this.specialExternalAccountRepo.save(specialExternalAccount);
  }

  async getMultiAccounts(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findCachedBy(`MultiAccounts`, {
      type: In([SpecialExternalAccountType.MULTI_ACCOUNT_IBAN, SpecialExternalAccountType.MULTI_ACCOUNT_BANK_NAME]),
    });
  }

  async getMultiAccountIbans(): Promise<string[]> {
    return this.getMultiAccounts().then((list) =>
      list.filter((a) => a.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN).map((a) => a.value),
    );
  }

  async getMultiAccountNames(): Promise<string[]> {
    return this.getMultiAccounts().then((list) =>
      list
        .filter((a) =>
          [SpecialExternalAccountType.MULTI_ACCOUNT_BANK_NAME, SpecialExternalAccountType.MULTI_ACCOUNT_IBAN].includes(
            a.type,
          ),
        )
        .map((a) => a.name),
    );
  }

  // Whether a payout address was reviewed and exempted from the Scorechain withdrawal gate.
  // Exact, case-insensitive comparison — deliberately NOT the regex matching of the ban lists: an
  // exemption suppresses an AML control, so an entry must never be able to cover more than the one
  // reviewed address. Only the Scorechain gate is skipped; every other AML check still applies.
  //
  // An exemption ages like the account-level review: it counts for `amlScorechainReviewValidity` days
  // from its last (re-)registration, then the address is screened again. Bounded on both sides for the
  // same reason as `UserData.hasValidScorechainReview` — an implausible future date must be treated as
  // no review at all, never as a longer one.
  async isScorechainExemptAddress(address: string): Promise<boolean> {
    const exemptions = await this.specialExternalAccountRepo.findCachedBy('ScorechainExemptAddresses', {
      type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
    });

    return exemptions.some((e) => {
      if (!e.value || !Util.equalsIgnoreCase(e.value, address)) return false;

      const daysSinceReview = Util.daysDiff(e.updated);
      return daysSinceReview >= 0 && daysSinceReview <= Config.amlScorechainReviewValidity;
    });
  }

  // Records a compliance release of a Scorechain-flagged payout address. Upsert keyed on the
  // case-insensitive address: a re-release refreshes `updated` and thereby restarts the validity
  // window instead of stacking duplicate rows. Reads uncached — the 5-minute list cache must not
  // resurrect a just-replaced row, and this path is far off the hot path.
  async registerScorechainExemptAddress(address: string, comment: string): Promise<void> {
    const existing = await this.specialExternalAccountRepo
      .findBy({ type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS })
      .then((list) => list.find((e) => e.value && Util.equalsIgnoreCase(e.value, address)));

    if (existing) {
      await this.specialExternalAccountRepo.update(existing.id, { comment });
    } else {
      await this.specialExternalAccountRepo.save(
        this.specialExternalAccountRepo.create({
          type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
          value: address,
          comment,
        }),
      );
    }

    this.specialExternalAccountRepo.invalidateCache();
  }

  async getPhoneCallList(): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findCachedBy('PhoneCallList', {
      type: In([
        SpecialExternalAccountType.AML_PHONE_CALL_NEEDED_BIC_BUY,
        SpecialExternalAccountType.AML_PHONE_CALL_NEEDED_IBAN_BUY,
        SpecialExternalAccountType.AML_PHONE_CALL_NEEDED_BLZ_BUY,
      ]),
    });
  }

  async getBlacklist(types?: SpecialExternalAccountType[]): Promise<SpecialExternalAccount[]> {
    return this.specialExternalAccountRepo.findCachedBy(`Blacklist-${types?.toString()}`, {
      type: In(
        types ?? [
          SpecialExternalAccountType.BANNED_IBAN,
          SpecialExternalAccountType.BANNED_IBAN_BUY,
          SpecialExternalAccountType.BANNED_IBAN_SELL,
          SpecialExternalAccountType.BANNED_IBAN_AML,
          SpecialExternalAccountType.BANNED_BIC,
          SpecialExternalAccountType.BANNED_BIC_BUY,
          SpecialExternalAccountType.BANNED_BIC_SELL,
          SpecialExternalAccountType.BANNED_BIC_AML,
          SpecialExternalAccountType.BANNED_MAIL,
          SpecialExternalAccountType.BANNED_ACCOUNT_IBAN,
          SpecialExternalAccountType.BANNED_BLZ,
          SpecialExternalAccountType.BANNED_BLZ_BUY,
          SpecialExternalAccountType.BANNED_BLZ_SELL,
          SpecialExternalAccountType.BANNED_BLZ_AML,
        ],
      ),
    });
  }
}
