export interface LndChannelBalanceDto {
  balance: number;
  pending_open_balance: number;
  local_balance: { sat: number };
  remote_balance: { sat: number };
}
