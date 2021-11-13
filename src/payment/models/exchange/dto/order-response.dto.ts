import { Fee } from "ccxt";

export interface PartialOrderResponse {
  id: string;
  price: number;
  amount: number;
  timestamp: Date;
  fee: Fee;
}

export interface OrderSummary {
  currencyPair: string;
  price: number;
  amount: number;
  orderSide: string;
  fees: number;
}

export interface OrderResponse {
  orderSummary: OrderSummary;
  orderList: PartialOrderResponse[];
}
