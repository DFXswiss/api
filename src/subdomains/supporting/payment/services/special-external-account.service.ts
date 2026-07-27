import { BadRequestException, Injectable } from '@nestjs/common';
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

  // Whether a payout address was manually reviewed and exempted from the Scorechain withdrawal gate.
  // Exact, case-insensitive comparison — deliberately NOT the regex matching of the ban lists: an
  // exemption suppresses an AML control, so an entry must never be able to cover more than the one
  // reviewed address. Only the Scorechain gate is skipped; every other AML check still applies.
  async isScorechainExemptAddress(address: string): Promise<boolean> {
    const exemptions = await this.specialExternalAccountRepo.findCachedBy('ScorechainExemptAddresses', {
      type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
    });

    return exemptions.some((e) => e.value && Util.equalsIgnoreCase(e.value, address));
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
