import { ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { BankTxType } from '../../bank-tx/bank-tx/entities/bank-tx.entity';

export type BankExchangeType = ExchangeTxType | BankTxType;

export type BalancesByFinancialType = {
  [financialType: string]: {
    plusBalance: number;
    plusBalanceChf: number;
    minusBalance: number;
    minusBalanceChf: number;
  };
};

export type TradingLog = {
  [priceRuleId: string]: {
    price1: number;
    price2: number;
    price3: number;
  };
};

export type AssetLog = {
  [assetId: string]: {
    priceChf: number;
    plusBalance: AssetLogPlusBalance;
    minusBalance: AssetLogMinusBalance;
  };
};

export type ManualDebtPosition = {
  assetId: number;
  value: number;
};

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
