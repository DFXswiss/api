import { WithdrawalResponse } from 'ccxt';
import { OrderResponse } from './order-response.dto';

export enum TradeStatus {
  OPEN = 'open',
  WITHDRAWING = 'withdrawing',
  CLOSED = 'closed',
  FAILED = 'failed',
}

export interface TradeResult {
  status: TradeStatus;
  trade?: OrderResponse;
  withdraw?: WithdrawalResponse;
  error?: Error;
}
