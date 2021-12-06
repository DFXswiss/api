import { Fee } from "ccxt";

export interface PartialTradeResponse {
  id: string;
  price: number;
  amount: number;
  timestamp: Date;
  fee: Fee;
}

export interface TradeSummary {
  currencyPair: string;
  price: number;
  amount: number;
  orderSide: string;
  fees: number;
}

export interface TradeResponse {
  orderSummary: TradeSummary;
  orderList: PartialTradeResponse[];
}
