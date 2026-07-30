import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';

/** k-anonymity threshold: disclosure units need min(transactions, distinct users) ≥ k. */
export const PARTNER_STATISTIC_SUPPRESSION_THRESHOLD = 5;

/** Default lookback when `from`/`to` are omitted (calendar days before `to`). */
export const PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS = 30;

/** Maximum allowed period span in calendar days (half-open [from, to)). */
export const PARTNER_STATISTIC_MAX_PERIOD_DAYS = 366;

/** Max concurrent SQL queries per partner-statistic request (pool size is 10). */
export const PARTNER_STATISTIC_QUERY_CONCURRENCY = 4;

export enum PartnerStatisticGranularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

/** Partner-facing trade direction (API contract; lowercase). */
export enum PartnerStatisticDirection {
  BUY = 'buy',
  SELL = 'sell',
  SWAP = 'swap',
}

export enum PartnerPaymentMethodName {
  BANK = 'Bank',
  CARD = 'Card',
  ON_CHAIN = 'OnChain',
  REFERRAL = 'Referral',
}

/** Maps transaction.sourceType to a partner-facing payment method label. */
export const PartnerPaymentMethodMap: { [key in TransactionSourceType]: PartnerPaymentMethodName } = {
  [TransactionSourceType.BANK_TX]: PartnerPaymentMethodName.BANK,
  [TransactionSourceType.CHECKOUT_TX]: PartnerPaymentMethodName.CARD,
  [TransactionSourceType.CRYPTO_INPUT]: PartnerPaymentMethodName.ON_CHAIN,
  [TransactionSourceType.REF]: PartnerPaymentMethodName.REFERRAL,
  [TransactionSourceType.MANUAL_REF]: PartnerPaymentMethodName.REFERRAL,
};
