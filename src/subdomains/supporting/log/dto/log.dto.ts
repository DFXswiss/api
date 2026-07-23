import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { BankTxType } from '../../bank-tx/bank-tx/entities/bank-tx.entity';

export type BankExchangeType = ExchangeTxType | BankTxType;

export interface ChangeLog {
  plus: ChangePlusBalance;
  minus: ChangeMinusBalance;
  total: number;
}

export interface FinanceLog {
  assets: AssetLog;
  tradings: TradingLog;
  balancesByFinancialType: BalancesByFinancialType;
  balancesTotal: BalancesTotal;
}

/**
 * Aggregate CHF valuation of the whole book at log time, written by LogJobService.
 *
 * `totalBalanceChf = plusBalanceChf - minusBalanceChf`, where plus/minus are each
 * asset's positive/negative balance valued at its current `priceChf`. Plus = assets
 * DFX holds, minus = liabilities owed to customers — plus the accrued referral-credit
 * liability (synthetic `RefCredit` financialType bucket): open ref credit is owed to
 * referrers and paid from DFX funds, so it belongs in minus.
 *
 * Invariant: customer flow is balance-neutral. A deposit raises plus AND minus by the
 * same amount; completing the order lowers both again, leaving only the fee in plus.
 * So `totalBalanceChf` never moves because a customer deposits or withdraws — it is
 * effectively the operating equity of the flow business and only moves due to:
 *   1. operating profit / fees — gradual, positive, realised on order completion
 *   2. FX — plus and minus are different asset baskets, so their CHF marks drift
 *      independently while orders are open (the normal intraday noise)
 *   3. an error or a realised loss — a discrete, persisting step
 *   4. snapshot skew — per-source balance reads are not atomic, so a snapshot taken
 *      while an internal transfer/order is in flight can double-count or miss the moving
 *      amount; such a spike reverts by the next 1-minute snapshot and is benign. A
 *      deviation that PERSISTS across multiple snapshots is never skew and must be treated
 *      as case 3.
 *
 * The open referral-credit liability is carried in minus continuously, so a ref payout is
 * balance-neutral (plus and minus drop together) instead of a phantom equity step; see
 * REF_CREDIT_FINANCIAL_TYPE in LogJobService.
 *
 * A single-snapshot step that reverts by the next snapshot is expected skew (case 4); a
 * step that persists (especially negative) is suspicious rather than customer activity.
 * Two guardrails act on this signal in LogJobService: the entry is flagged `valid: false`
 * when the jump vs. the last VALID entry (not necessarily the direct predecessor) exceeds
 * `Config.financeLogTotalBalanceChangeLimit` and the current total does not yet form a stable
 * plateau with its immediate predecessors, and safety mode is triggered when
 * `totalBalanceChf` drops below the `minTotalBalanceChf` setting or is not finite
 * (unknown books fail closed). A non-finite total is never `valid`, so it can not
 * become the comparison baseline. A persisting new level is adopted as `valid` only once
 * `Config.financeLogStabilityWindow` consecutive snapshots (current + predecessors) agree
 * within one change-limit band — replacing the old 15-minute force-validate, which trusted
 * a single unverified reading. Such a level-shift adoption is tagged `validatedByStability`
 * (see `BalancesTotal.validatedByStability`).
 */
export interface BalancesTotal {
  plusBalanceChf: number;
  minusBalanceChf: number;
  totalBalanceChf: number;
  /**
   * Per-interval price effect (FX P&L) of the open positions vs. the previous snapshot: the sum over
   * assets of each one's previous net position times the change in its CHF price. Customer flow is
   * balance-neutral, so `ΔtotalBalanceChf ≈ transactional yield + fxPnlChf + errors`. Absent (not 0) on
   * the first entry, which has no previous snapshot to diff against.
   */
  fxPnlChf?: number;
  /**
   * Set (true) only when this entry was adopted as valid via the stability path — i.e. a level shift beyond
   * `financeLogTotalBalanceChangeLimit` that was trusted because the current total and its predecessors form
   * a stable plateau, not because it hugs the last valid baseline. Absent (not false) on normal-drift entries.
   * The ledger equity-parity check excludes these level-shift adoptions from its median baseline (#4313).
   */
  validatedByStability?: boolean;
}

export interface BalancesByFinancialType {
  [financialType: string]: {
    plusBalance: number;
    plusBalanceChf: number;
    minusBalance: number;
    minusBalanceChf: number;
  };
}

export interface TradingLog {
  [priceRuleId: string]: {
    price1: number;
    price2: number;
    price3: number;
  };
}

export interface AssetLog {
  [assetId: string]: {
    priceChf: number;
    plusBalance: AssetLogPlusBalance;
    minusBalance: AssetLogMinusBalance;
    // the writer's error line is currently disabled (log-job.service.ts getAssetLog) — serialized entries carry no
    // error field, so the type must not promise one
    error?: string;
  };
}

// manual debt
export type ManualLogPosition = {
  assetId: number;
  value: number;
};

// pairIds
export type LogPairId = {
  fromKraken: { eur: PairId; chf: PairId };
  toKraken: { eur: PairId; chf: PairId };
  fromScrypt?: { eur: PairId; chf: PairId };
  toScrypt?: { eur: PairId; chf: PairId };
};

type PairId = {
  bankTxId: number;
  exchangeTxId: number;
};

// asset log
type AssetLogPlusBalance = {
  total: number;
  liquidity?: AssetLogLiquidity;
  custom?: AssetLogPlusCustom;
  pending?: AssetLogPlusPending;
  monitoring?: AssetLogMonitoring;
};

type AssetLogLiquidity = {
  total: number;
  liquidityBalance?: AssetLogPlusCustom;
  paymentDepositBalance?: { total: number };
  manualLiqPosition?: { total: number };
};

type AssetLogMinusBalance = {
  total: number;
  debt?: number;
  pending?: AssetLogMinusPending;
  monitoring?: AssetLogMonitoring;
};

type AssetLogMonitoring = {
  fromKrakenBankTxIds: string;
  toKrakenBankTxIds: string;
  fromKrakenExchangeTxIds: string;
  toKrakenExchangeTxIds: string;
};

type AssetLogPlusCustom = {
  total: number;
  [customAddress: string]: number;
};

type AssetLogPlusPending = {
  total: number;
  cryptoInput?: number;
  exchangeOrder?: number;
  bridgeOrder?: number;
  fromOlky?: number;
  fromKraken?: number;
  toKraken?: number;
  fromScrypt?: number;
  toScrypt?: number;
};

type AssetLogMinusPending = {
  total: number;
  buyFiat?: number;
  buyFiatPass?: number;
  buyCrypto?: number;
  buyCryptoPass?: number;
  bankTxNull?: number;
  bankTxPending?: number;
  bankTxUnknown?: number;
  bankTxGSheet?: number;
  bankTxRepeat?: number;
  bankTxReturn?: number;
};

// change log

type ChangePlusBalance = {
  total: number;
  buyCrypto?: number;
  buyFiat?: number;
  paymentLink?: number;
  trading?: number;
};

type ChangeMinusBalance = {
  total: number;
  bank?: number;
  kraken?: ChangeExchangeBalance;
  binance?: ChangeExchangeBalance;
  scrypt?: ChangeExchangeBalance;
  mexc?: ChangeExchangeBalance;
  blockchain?: ChangeBlockchainBalance;
  ref?: ChangeRefBalance;
};

type ChangeExchangeBalance = {
  total: number;
  withdraw?: number;
  trading?: number;
};

type ChangeBlockchainBalance = {
  total: number;
  tx?: ChangeBlockchainTxBalance;
  trading?: number;
  lm?: number;
};

type ChangeBlockchainTxBalance = {
  total: number;
  in?: number;
  out?: number;
};

type ChangeRefBalance = {
  total: number;
  amount?: number;
  fee?: number;
};
