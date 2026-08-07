import { BadRequestException, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { In, Raw } from 'typeorm';
import { CreateSpecialExternalAccountDto } from '../dto/input/create-special-external-account.dto';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../entities/special-external-account.entity';
import { SpecialExternalAccountRepository } from '../repositories/special-external-account.repository';

@Injectable()
export class SpecialExternalAccountService {
  constructor(private readonly specialExternalAccountRepo: SpecialExternalAccountRepository) {}

  async createSpecialExternalAccount(dto: CreateSpecialExternalAccountDto): Promise<SpecialExternalAccount> {
    // Exempt-address rows are append-only events (each registration restarts the validity window),
    // so duplicates are legitimate there; every other type is unique.
    if (dto.type !== SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS) {
      const existing = await this.specialExternalAccountRepo.findOneBy({ type: dto.type, value: dto.value });
      if (existing) throw new BadRequestException('Special external account already created');
    }

    const specialExternalAccount = this.specialExternalAccountRepo.create(dto);
    const saved = await this.specialExternalAccountRepo.save(specialExternalAccount);

    // The list lookups of the other types are served from the 5-minute cache — a manual admin write
    // must become visible on this instance without waiting for the TTL.
    this.specialExternalAccountRepo.invalidateCache();

    return saved;
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

  // Whether a payout address was reviewed and exempted from the Scorechain withdrawal gate on this
  // chain. Exact, case-insensitive match on (blockchain, address) — deliberately NOT the regex
  // matching of the ban lists: an exemption suppresses an AML control, so an entry must never cover
  // more than the one reviewed address on the one reviewed chain.
  //
  // Deliberately UNCACHED: this gates a billable AML control, so a revocation (deleting the rows)
  // must take effect immediately on every instance; the check runs once per pending payout in the
  // preparation job, far off any hot path.
  async isScorechainExemptAddress(blockchain: Blockchain, address: string): Promise<boolean> {
    const exemptions = await this.specialExternalAccountRepo.find({
      where: {
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        blockchain,
        value: Raw((alias) => `LOWER(${alias}) = :address`, { address: address.toLowerCase() }),
      },
    });

    return exemptions.some((e) => e.hasValidScorechainExemption);
  }

  // Records a compliance release of a Scorechain-flagged payout address. Append-only: every release
  // is an immutable event row, the validity window runs from the row's `created` date. No upsert —
  // the previous registration (when, from which release) must stay reconstructible, and concurrent
  // releases must not race a check-then-act. Revoking an exemption means deleting ALL its valid rows.
  async registerScorechainExemptAddress(blockchain: Blockchain, address: string, comment: string): Promise<void> {
    await this.specialExternalAccountRepo.save(
      this.specialExternalAccountRepo.create({
        type: SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
        blockchain,
        value: address,
        comment,
      }),
    );
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
