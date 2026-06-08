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
  // Month-to-date operating result (= ChangeLog.total) captured at log time. Used to reconcile the
  // total-balance delta between snapshots: a valid snapshot's total only moves by operating result + FX.
  // Optional because snapshots written before this field existed do not carry it.
  changesTotal?: number;
}

/**
 * Aggregate CHF valuation of the whole book at log time, written by LogJobService.
 *
 * `totalBalanceChf = plusBalanceChf - minusBalanceChf`, where plus/minus are each
 * asset's positive/negative balance valued at its current `priceChf`. Plus = assets
 * DFX holds, minus = liabilities owed to customers.
 *
 * Invariant: customer flow is balance-neutral. A deposit raises plus AND minus by the
 * same amount; completing the order lowers both again, leaving only the fee in plus.
 * So `totalBalanceChf` never moves because a customer deposits or withdraws — it is
 * effectively the operating equity of the flow business and only moves due to:
 *   1. operating profit / fees — gradual, positive, realised on order completion
 *   2. FX — plus and minus are different asset baskets, so their CHF marks drift
 *      independently while orders are open (the normal intraday noise)
 *   3. an error or a realised loss — a discrete, persisting step
 *
 * A sudden step (especially negative) is therefore suspicious rather than customer
 * activity. Two guardrails act on this signal in LogJobService: the entry is flagged
 * `valid: false` when the jump vs. the previous entry exceeds
 * `Config.financeLogTotalBalanceChangeLimit` and that entry is under 15 minutes old (a
 * larger logging gap suppresses the flag), and safety mode is triggered when
 * `totalBalanceChf` drops below the `minTotalBalanceChf` setting.
 */
export interface BalancesTotal {
  plusBalanceChf: number;
  minusBalanceChf: number;
  totalBalanceChf: number;
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
    error: string;
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
  paymentDepositBalance?: number;
  manualLiqPosition?: number;
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
