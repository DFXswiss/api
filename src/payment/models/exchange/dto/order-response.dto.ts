export interface PartialOrderResponse {
  id: string;
  price: number;
  amount: number;
}

export interface OrderResponse {
  order: PartialOrderResponse;
  partialFills: PartialOrderResponse[];
}
