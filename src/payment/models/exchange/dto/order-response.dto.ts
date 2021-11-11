export interface PartialOrderResponse {
  id: string;
  price: number;
  amount: number;
  timestamp: number;
  orderSide: string;
}

export interface OrderSummary {
  price: number;
  amount: number;
  orderSide: string;
}

export interface OrderResponse {
  orderSummary: OrderSummary;
  orderList: PartialOrderResponse[];
}
