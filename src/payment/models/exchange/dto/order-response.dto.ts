export interface PartialOrderResponse {
  id: string;
  price: number;
  amount: number;
  timestamp: Date;
}

export interface OrderSummary {
  currencyPair: string;
  price: number;
  amount: number;
  orderSide: string;
}

export interface OrderResponse {
  orderSummary: OrderSummary;
  orderList: PartialOrderResponse[];
}
