import { TransactionSourceType } from 'src/subdomains/supporting/payment/entities/transaction.entity';

/** k-anonymity threshold: disclosure units need min(transactions, distinct users) ≥ k. */
export const PARTNER_STATISTIC_SUPPRESSION_THRESHOLD = 5;

/**
 * Default lookback when `from`/`to` are omitted: this many inclusive UTC calendar days
 * ending on the resolved `to` day (half-open period after snap).
 */
export const PARTNER_STATISTIC_DEFAULT_PERIOD_DAYS = 30;

/** Maximum allowed period span in calendar days (half-open [from, to)). */
export const PARTNER_STATISTIC_MAX_PERIOD_DAYS = 366;

/**
 * Max concurrent SQL queries per partner-statistic request.
 * Kept well below the default TypeORM pool size (`SQL_POOL_MAX` defaults to 10) so one
 * request cannot monopolise the pool; the effective pool size may differ per environment.
 */
export const PARTNER_STATISTIC_QUERY_CONCURRENCY = 4;

export enum PartnerStatisticGranularity {
  DAY = 'Day',
  WEEK = 'Week',
  MONTH = 'Month',
}

export enum PartnerStatisticDirection {
  BUY = 'Buy',
  SELL = 'Sell',
  SWAP = 'Swap',
}

/**
 * Maps partner-facing direction enums to the camelCase DTO field names used on
 * volume / transactions / users objects (`buy` / `sell` / `swap`). Explicit so enum
 * values (PascalCase API contract) stay decoupled from JSON property names.
 */
export const PartnerStatisticDirectionField: {
  readonly [K in PartnerStatisticDirection]: 'buy' | 'sell' | 'swap';
} = {
  [PartnerStatisticDirection.BUY]: 'buy',
  [PartnerStatisticDirection.SELL]: 'sell',
  [PartnerStatisticDirection.SWAP]: 'swap',
};

/** Postgres `DATE_TRUNC` unit for each granularity (API values are PascalCase). */
export const PartnerStatisticDateTruncUnit: {
  readonly [K in PartnerStatisticGranularity]: 'day' | 'week' | 'month';
} = {
  [PartnerStatisticGranularity.DAY]: 'day',
  [PartnerStatisticGranularity.WEEK]: 'week',
  [PartnerStatisticGranularity.MONTH]: 'month',
};

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
