import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity } from 'typeorm';

export enum SpecialExternalAccountType {
  MULTI_ACCOUNT_IBAN = 'MultiAccountIban',
  MULTI_ACCOUNT_BANK_NAME = 'MultiAccountBankName',
  BANNED_IBAN = 'BannedIban',
  BANNED_IBAN_BUY = 'BannedIbanBuy',
  BANNED_IBAN_SELL = 'BannedIbanSell',
  BANNED_IBAN_AML = 'BannedIbanAml',
  BANNED_BIC = 'BannedBic',
  BANNED_BIC_BUY = 'BannedBicBuy',
  BANNED_BIC_SELL = 'BannedBicSell',
  BANNED_BIC_AML = 'BannedBicAml',
  BANNED_BLZ = 'BannedBlz',
  BANNED_BLZ_BUY = 'BannedBlzBuy',
  BANNED_BLZ_SELL = 'BannedBlzSell',
  BANNED_BLZ_AML = 'BannedBlzAml',
  BANNED_MAIL = 'BannedMail',
  BANNED_ACCOUNT_IBAN = 'BannedAccountIban',
  AML_PHONE_CALL_NEEDED_BIC_BUY = 'AmlPhoneCallNeededBicBuy',
  AML_PHONE_CALL_NEEDED_BLZ_BUY = 'AmlPhoneCallNeededBlzBuy',
  AML_PHONE_CALL_NEEDED_IBAN_BUY = 'AmlPhoneCallNeededIbanBuy',
  // Compliance-reviewed payout address: suppresses the recurring Scorechain withdrawal gate for an
  // address whose high risk score was manually analyzed and cleared (e.g. third-party address
  // poisoning against a customer wallet). Matched exactly (case-insensitive), never as regex.
  SCORECHAIN_EXEMPT_ADDRESS = 'ScorechainExemptAddress',
}

@Entity()
export class SpecialExternalAccount extends IEntity {
  @Column({ length: 256 })
  type: SpecialExternalAccountType;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  value?: string;

  @Column({ length: 256, nullable: true })
  comment?: string;

  // Payout chain the exemption is bound to. Only set for ScorechainExemptAddress rows: the on-chain
  // risk of an address is chain-specific, so a review on one chain must never exempt the same string
  // on another. A row without a blockchain never matches (fail-closed).
  @Column({ length: 256, nullable: true })
  blockchain?: Blockchain;

  // --- ENTITY METHODS --- //

  matches(types: SpecialExternalAccountType[], value: string): boolean {
    return types.some((t) => this.type === t) && new RegExp(this.value).test(value);
  }

  // A Scorechain address exemption ages like the account-level review (`amlScorechainReviewValidity`):
  // the risk of a payout destination is re-assessed rather than trusted indefinitely. Window runs from
  // `created` (append-only event time), not `updated` — an admin edit of the comment must never extend
  // the exemption.
  //
  // Bounded on BOTH sides on purpose: a date in the future makes `daysDiff` negative, which would suppress
  // the screening for longer than the configured window. The exemption must never outlast
  // `amlScorechainReviewValidity`, no matter how the value reached the column (operator typo, direct DB
  // write, data import) — so an implausible date is treated as no review at all, never as a longer one.
  get hasValidScorechainExemption(): boolean {
    if (this.type !== SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS) return false;

    const daysSinceReview = Util.daysDiff(this.created);
    return daysSinceReview >= 0 && daysSinceReview <= Config.amlScorechainReviewValidity;
  }
}
