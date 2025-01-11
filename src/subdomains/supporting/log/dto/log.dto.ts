import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { BankTxType } from '../../bank-tx/bank-tx/entities/bank-tx.entity';

export type BankExchangeType = ExchangeTxType | BankTxType;

export interface ChangeLog {
  plus: ChangePlusBalance;
  minus: ChangeMinusBalance;
  total: number;
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
  };
}

// manual debt

export type ManualLogPosition = {
  assetId: number;
  value: number;
};

// asset log
type AssetLogPlusBalance = {
  total: number;
  liquidity?: number;
  pending?: AssetLogPlusPending;
};

type AssetLogMinusBalance = {
  total: number;
  debt?: number;
  pending?: AssetLogMinusPending;
};

type AssetLogPlusPending = {
  total: number;
  cryptoInput?: number;
  exchangeOrder?: number;
  fromOlky?: number;
  fromKraken?: number;
  toKraken?: number;
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
