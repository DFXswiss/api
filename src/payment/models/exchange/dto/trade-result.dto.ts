import { WithdrawalResponse } from 'ccxt';
import { TradeResponse } from './trade-response.dto';

export enum TradeStatus {
  OPEN = 'open',
  WITHDRAWING = 'withdrawing',
  CLOSED = 'closed',
  FAILED = 'failed',
}

export interface TradeResult {
  status: TradeStatus;
  trade?: TradeResponse;
  withdraw?: WithdrawalResponse;
  error?: Error;
}
