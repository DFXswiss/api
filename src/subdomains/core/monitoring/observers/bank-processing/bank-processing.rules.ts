export type BankProcessingBlockKey =
  | 'bankTx'
  | 'buyCryptoFiat'
  | 'buyCryptoCrypto'
  | 'buyFiat'
  | 'fiatOutput'
  | 'bankTxReturn';

export type ToleranceValue = { type: 'fixed'; minutes: number } | { type: 'dynamic'; offsetMinutes: number }; // dynamicToleranceMinutes(now) + offsetMinutes

interface BankProcessingRuleBase {
  key: string; // stable, kebab-case — monitoring interface, never rename
  label: string; // short description (German, shown on the ops dashboard)
  block: BankProcessingBlockKey;
  condition: string; // SQL fragment (Postgres) on the block aliases; camelCase columns MUST be double-quoted
}

// Discriminated on tolerance: when set, toleranceField is required; when null, display-only (no overdue).
// Distributed as a top-level union — TS cannot narrow `Base & (A | B)` through the discriminant.
export type BankProcessingRule =
  | (BankProcessingRuleBase & { tolerance: null })
  | (BankProcessingRuleBase & { tolerance: ToleranceValue; toleranceField: 'created' | 'updated' });

export interface BankProcessingBlock {
  key: BankProcessingBlockKey;
  alias: string; // base alias in the query builder
  where: string; // block-level WHERE (SQL, Postgres)
  joins: { target: 'relation' | 'fiatByCurrency'; property?: string; alias: string }[];
  chfExpr: string; // SQL expression for the CHF value of a row (may evaluate to NULL)
}

// Allowed waiting time per hour of day (Europe/Zurich), index = hour 0-23, value in minutes.
// Ported from the legacy ops monitoring rules (longer tolerances at night).
export const HOURLY_TOLERANCE_MINUTES: readonly number[] = [
  720,
  780,
  840,
  900,
  960,
  1020,
  1080, // 00-06h: 12h..18h (longer at night)
  120,
  120,
  120,
  120,
  120,
  120,
  120,
  120, // 07-14h: 2h
  180,
  240,
  300,
  360,
  420,
  480,
  540,
  600,
  660, // 15-23h: 3h..11h
];

const ZURICH_TZ = 'Europe/Zurich';

/** Hour / minute / weekday in Europe/Zurich (no UTC fallback). */
function zurichTimeParts(now: Date): { hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZURICH_TZ,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing DateTimeFormat part "${type}" for ${ZURICH_TZ}`);
    return part.value;
  };

  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: get('weekday'),
  };
}

export function dynamicToleranceMinutes(now: Date): number {
  const { hour, minute, weekday } = zurichTimeParts(now);
  let minutes = HOURLY_TOLERANCE_MINUTES[hour];

  // Weekend surcharge: Sat +1.5d / Sun +2.5d / Mon before 07:12 +3.5d
  if (weekday === 'Sat') {
    minutes += 2160;
  } else if (weekday === 'Sun') {
    minutes += 3600;
  } else if (weekday === 'Mon' && (hour < 7 || (hour === 7 && minute < 12))) {
    minutes += 5040;
  }

  return minutes;
}

export function toleranceMinutesFor(rule: BankProcessingRule, now: Date): number | null {
  if (rule.tolerance === null) return null;
  if (rule.tolerance.type === 'fixed') return rule.tolerance.minutes;
  return dynamicToleranceMinutes(now) + rule.tolerance.offsetMinutes;
}

export function cutoffFor(rule: BankProcessingRule, now: Date): Date | null {
  const minutes = toleranceMinutesFor(rule, now);
  if (minutes === null) return null;
  return new Date(now.getTime() - minutes * 60 * 1000);
}

export const BANK_PROCESSING_BLOCKS: Record<BankProcessingBlockKey, BankProcessingBlock> = {
  bankTx: {
    key: 'bankTx',
    alias: 'bt',
    where: `bt."type" IS NULL OR bt."type" IN ('Pending', 'GSheet')`,
    joins: [{ target: 'fiatByCurrency', alias: 'f' }],
    // Approximation via the fiat table's approxPriceChf; rows with non-convertible currencies
    // drop out of the CHF sum (the count stays complete)
    chfExpr: `bt."amount" * f."approxPriceChf"`,
  },
  buyCryptoFiat: {
    key: 'buyCryptoFiat',
    alias: 'bc',
    where: `bc."bankTxId" IS NOT NULL AND bc."isComplete" = false AND (asset."uniqueName" IS NULL OR asset."uniqueName" != 'Ethereum/DEPSPresale')`,
    joins: [
      { target: 'relation', property: 'bc.buy', alias: 'buy' },
      { target: 'relation', property: 'buy.asset', alias: 'asset' },
    ],
    chfExpr: `bc."amountInChf"`,
  },
  buyCryptoCrypto: {
    key: 'buyCryptoCrypto',
    alias: 'bc',
    where: `bc."cryptoInputId" IS NOT NULL AND bc."isComplete" = false AND (bc."amlReason" IS NULL OR bc."amlReason" != 'MinDepositNotReached')`,
    joins: [],
    chfExpr: `bc."amountInChf"`,
  },
  buyFiat: {
    key: 'buyFiat',
    alias: 'bf',
    where: `bf."isComplete" = false`,
    joins: [],
    chfExpr: `bf."amountInChf"`,
  },
  fiatOutput: {
    key: 'fiatOutput',
    alias: 'fo',
    where: `COALESCE(fo."isComplete", false) = false`,
    joins: [{ target: 'fiatByCurrency', alias: 'f' }],
    chfExpr: `fo."amount" * f."approxPriceChf"`,
  },
  bankTxReturn: {
    key: 'bankTxReturn',
    alias: 'btr',
    where: `btr."chargebackBankTxId" IS NULL`,
    joins: [],
    chfExpr: `btr."amountInChf"`,
  },
};

export const BANK_PROCESSING_RULES: readonly BankProcessingRule[] = [
  // bankTx
  {
    key: 'bank-tx-unassigned',
    label: 'Bank-Tx ohne Typ (Zuordnung ausstehend)',
    block: 'bankTx',
    condition: `bt."type" IS NULL`,
    tolerance: { type: 'fixed', minutes: 55 },
    toleranceField: 'created',
  },
  {
    key: 'bank-tx-gsheet',
    label: 'Bank-Tx Typ GSheet (manuelle Zuordnung)',
    block: 'bankTx',
    condition: `bt."type" = 'GSheet'`,
    tolerance: null,
  },
  {
    key: 'bank-tx-pending',
    label: 'Bank-Tx Typ Pending',
    block: 'bankTx',
    condition: `bt."type" = 'Pending'`,
    tolerance: null,
  },

  // buyCryptoFiat
  {
    key: 'bc-aml-unchecked',
    label: 'BuyCrypto ohne AML-Check',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'bc-aml-gsheet',
    label: 'BuyCrypto AML-Check GSheet',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'GSheet'`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'bc-aml-manual-check',
    label: 'BuyCrypto AML Pending ManualCheck',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pending' AND bc."amlReason" = 'ManualCheck'`,
    tolerance: { type: 'fixed', minutes: 7200 },
    toleranceField: 'created',
  },
  {
    key: 'bc-aml-phone-check',
    label: 'BuyCrypto AML Pending PhoneCheck',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pending' AND bc."amlReason" = 'ManualCheckPhone'`,
    tolerance: null,
  },
  {
    key: 'bc-aml-pending-other',
    label: 'BuyCrypto AML Pending (übrige)',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pending' AND (bc."amlReason" IS NULL OR bc."amlReason" NOT IN ('ManualCheck', 'ManualCheckPhone', 'BankReleasePending'))`,
    tolerance: { type: 'fixed', minutes: 20160 },
    toleranceField: 'created',
  },
  {
    key: 'bc-price-definition-missing',
    label: 'BuyCrypto Pass ohne priceDefinitionAllowedDate',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."priceDefinitionAllowedDate" IS NULL`,
    tolerance: null,
  },
  {
    key: 'bc-payout-pending',
    label: 'BuyCrypto Auszahlung ausstehend (ohne BTC/XMR)',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" != 'Stopped' AND asset."uniqueName" NOT IN ('Bitcoin/BTC', 'Monero/XMR', 'Citrea/PreJUICE')`,
    tolerance: { type: 'fixed', minutes: 30 },
    toleranceField: 'created',
  },
  {
    key: 'bc-payout-pending-btc',
    label: 'BuyCrypto Auszahlung ausstehend BTC',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" != 'Stopped' AND asset."uniqueName" = 'Bitcoin/BTC'`,
    tolerance: { type: 'dynamic', offsetMinutes: 0 },
    toleranceField: 'updated',
  },
  {
    key: 'bc-payout-pending-xmr',
    label: 'BuyCrypto Auszahlung ausstehend XMR',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" != 'Stopped' AND asset."uniqueName" = 'Monero/XMR'`,
    tolerance: { type: 'dynamic', offsetMinutes: 0 },
    toleranceField: 'created',
  },
  {
    key: 'bc-payout-paying-out',
    label: 'BuyCrypto Status PayingOut',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" = 'PayingOut' AND asset."uniqueName" NOT IN ('Bitcoin/BTC', 'Monero/XMR')`,
    tolerance: { type: 'dynamic', offsetMinutes: 0 },
    toleranceField: 'updated',
  },
  {
    key: 'bc-payout-missing-liquidity',
    label: 'BuyCrypto Status MissingLiquidity',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" = 'MissingLiquidity'`,
    tolerance: { type: 'fixed', minutes: 30 },
    toleranceField: 'updated',
  },
  {
    key: 'bc-payout-waiting-lower-fee',
    label: 'BuyCrypto Status WaitingForLowerFee',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND bc."txId" IS NULL AND bc."status" = 'WaitingForLowerFee'`,
    tolerance: { type: 'fixed', minutes: 65 },
    toleranceField: 'created',
  },
  {
    key: 'bc-talium',
    label: 'BuyCrypto Talium/DMCS (manueller Payout)',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Pass' AND asset."uniqueName" = 'Talium/DMCS'`,
    tolerance: null,
  },
  {
    key: 'bc-chargeback-iban-missing',
    label: 'BuyCrypto Fail ohne chargebackIban',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Fail' AND bc."chargebackIban" IS NULL`,
    tolerance: null,
  },
  {
    key: 'bc-chargeback-date-missing',
    label: 'BuyCrypto Fail ohne chargebackAllowedDate',
    block: 'buyCryptoFiat',
    condition: `bc."amlCheck" = 'Fail' AND bc."chargebackIban" IS NOT NULL AND bc."chargebackAllowedDate" IS NULL`,
    tolerance: { type: 'dynamic', offsetMinutes: 10200 },
    toleranceField: 'created',
  },

  // buyCryptoCrypto
  {
    key: 'cc-aml-unchecked',
    label: 'CryptoCrypto ohne AML-Check',
    block: 'buyCryptoCrypto',
    condition: `bc."amlCheck" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'cc-aml-gsheet',
    label: 'CryptoCrypto AML GSheet',
    block: 'buyCryptoCrypto',
    condition: `bc."amlCheck" = 'GSheet'`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'cc-aml-pending',
    label: 'CryptoCrypto AML Pending',
    block: 'buyCryptoCrypto',
    condition: `bc."amlCheck" = 'Pending'`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'cc-payout-pending',
    label: 'CryptoCrypto Auszahlung ausstehend',
    block: 'buyCryptoCrypto',
    condition: `bc."amlCheck" = 'Pass' AND bc."status" != 'PendingAggregation'`,
    tolerance: { type: 'fixed', minutes: 75 },
    toleranceField: 'created',
  },
  {
    key: 'cc-chargeback-pending',
    label: 'CryptoCrypto Rückzahlung beauftragen (Fail)',
    block: 'buyCryptoCrypto',
    condition: `bc."amlCheck" = 'Fail'`,
    tolerance: null,
  },

  // buyFiat
  {
    key: 'bf-total',
    label: 'BuyFiat offen gesamt',
    block: 'buyFiat',
    condition: 'true',
    tolerance: null,
  },
  {
    key: 'bf-aml-unchecked',
    label: 'BuyFiat ohne AML-Check',
    block: 'buyFiat',
    condition: `bf."amlCheck" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'bf-aml-gsheet',
    label: 'BuyFiat AML GSheet',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'GSheet'`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'bf-aml-manual-check',
    label: 'BuyFiat AML Pending ManualCheck',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'Pending' AND bf."amlReason" = 'ManualCheck'`,
    tolerance: { type: 'fixed', minutes: 0 },
    toleranceField: 'created',
  },
  {
    key: 'bf-aml-pending-other',
    label: 'BuyFiat AML Pending (übrige)',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'Pending' AND (bf."amlReason" IS NULL OR bf."amlReason" != 'ManualCheck')`,
    tolerance: { type: 'fixed', minutes: 20160 },
    toleranceField: 'created',
  },
  {
    key: 'bf-output-amount-missing',
    label: 'BuyFiat Pass ohne outputAmount',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'Pass' AND bf."outputAmount" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'bf-pass-incomplete',
    label: 'BuyFiat Pass nicht abgeschlossen',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'Pass'`,
    tolerance: null,
  },
  {
    key: 'bf-chargeback-pending',
    label: 'BuyFiat Rückzahlung ausstehend (Fail)',
    block: 'buyFiat',
    condition: `bf."amlCheck" = 'Fail'`,
    tolerance: null,
  },

  // fiatOutput
  {
    key: 'fo-total-open',
    label: 'FiatOutput offen gesamt',
    block: 'fiatOutput',
    condition: `fo."bankTxId" IS NULL`,
    tolerance: null,
  },
  {
    key: 'fo-origin-missing',
    label: 'FiatOutput ohne originEntityId',
    block: 'fiatOutput',
    condition: `fo."originEntityId" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'fo-iban-missing',
    label: 'FiatOutput ohne accountIban',
    block: 'fiatOutput',
    condition: `fo."originEntityId" IS NOT NULL AND fo."accountIban" IS NULL`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'fo-buyfiat-output-missing',
    label: 'FiatOutput: BuyFiat-outputAmount fehlt',
    block: 'fiatOutput',
    // EXISTS instead of a join: correlated buy_fiat check without duplicating rows in the aggregation
    condition: `fo."accountIban" IS NOT NULL AND fo."remittanceInfo" IS NULL AND fo."isReadyDate" IS NULL AND EXISTS (SELECT 1 FROM buy_fiat bfx WHERE bfx."fiatOutputId" = fo."id" AND bfx."outputAmount" IS NULL)`,
    tolerance: { type: 'fixed', minutes: 15 },
    toleranceField: 'created',
  },
  {
    key: 'fo-remittance-missing',
    label: 'FiatOutput ohne remittanceInfo',
    block: 'fiatOutput',
    condition: `fo."accountIban" IS NOT NULL AND fo."remittanceInfo" IS NULL AND NOT EXISTS (SELECT 1 FROM buy_fiat bfx WHERE bfx."fiatOutputId" = fo."id" AND bfx."outputAmount" IS NULL)`,
    tolerance: { type: 'dynamic', offsetMinutes: 120 },
    toleranceField: 'updated',
  },
  {
    key: 'fo-ready-missing-chf',
    label: 'FiatOutput CHF ohne isReadyDate',
    block: 'fiatOutput',
    condition: `fo."remittanceInfo" IS NOT NULL AND fo."isReadyDate" IS NULL AND fo."currency" = 'CHF'`,
    tolerance: { type: 'dynamic', offsetMinutes: 120 },
    toleranceField: 'created',
  },
  {
    key: 'fo-ready-missing-eur',
    label: 'FiatOutput EUR ohne isReadyDate',
    block: 'fiatOutput',
    condition: `fo."remittanceInfo" IS NOT NULL AND fo."isReadyDate" IS NULL AND fo."currency" = 'EUR' AND fo."type" != 'LiqManagement'`,
    tolerance: { type: 'dynamic', offsetMinutes: 120 },
    toleranceField: 'created',
  },
  {
    key: 'fo-olkypay-untransmitted',
    label: 'FiatOutput Olkypay nicht übermittelt',
    block: 'fiatOutput',
    condition: `fo."isReadyDate" IS NOT NULL AND fo."batchId" IS NOT NULL AND fo."isTransmittedDate" IS NULL AND fo."accountIban" = 'LU116060002000005040'`,
    tolerance: { type: 'fixed', minutes: 20 },
    toleranceField: 'updated',
  },
  {
    key: 'fo-unconfirmed',
    label: 'FiatOutput ohne isConfirmedDate',
    block: 'fiatOutput',
    condition: `fo."isReadyDate" IS NOT NULL AND fo."isConfirmedDate" IS NULL`,
    tolerance: null,
  },
  {
    key: 'fo-unapproved',
    label: 'FiatOutput ohne isApprovedDate',
    block: 'fiatOutput',
    condition: `fo."isReadyDate" IS NOT NULL AND fo."isApprovedDate" IS NULL`,
    tolerance: null,
  },
  {
    key: 'fo-approved-untransmitted',
    label: 'FiatOutput approved, nicht übermittelt',
    block: 'fiatOutput',
    condition: `fo."isReadyDate" IS NOT NULL AND fo."isApprovedDate" IS NOT NULL AND fo."isTransmittedDate" IS NULL`,
    tolerance: null,
  },
  {
    key: 'fo-banktx-missing',
    label: 'FiatOutput approved ohne bankTx',
    block: 'fiatOutput',
    condition: `fo."isApprovedDate" IS NOT NULL AND fo."bankTxId" IS NULL`,
    tolerance: { type: 'dynamic', offsetMinutes: 0 },
    toleranceField: 'updated',
  },
  {
    key: 'fo-incomplete-with-banktx',
    label: 'FiatOutput mit bankTx, nicht komplett',
    block: 'fiatOutput',
    condition: `fo."bankTxId" IS NOT NULL`,
    tolerance: null,
  },

  // bankTxReturn
  {
    key: 'btr-open',
    label: 'BankTxReturn nicht zurückgebucht',
    block: 'bankTxReturn',
    condition: 'true',
    tolerance: { type: 'dynamic', offsetMinutes: 120 },
    toleranceField: 'updated',
  },
];
