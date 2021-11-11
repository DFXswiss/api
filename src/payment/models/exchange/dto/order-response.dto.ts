export interface PartialOrderResponse {
  id: string;
  price: number;
  amount: number;
  timestamp: number;
  orderSide: string;
}

export interface OrderResponse {
  order: PartialOrderResponse;
  partialFills: PartialOrderResponse[];
}
