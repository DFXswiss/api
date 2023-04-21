import { TradeResponse } from './trade-response.dto';

export enum TradeStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  FAILED = 'failed',
}

export interface TradeResult {
  exchange: string;
  status: TradeStatus;
  orders: string[];
  trade?: TradeResponse;
  error?: Error;
}
