import { OrderResponse } from './order-response.dto';

export enum TradeStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  FAILED = 'failed',
}

export interface Trade {
  status: TradeStatus;
  result: OrderResponse | Error | undefined;
}
