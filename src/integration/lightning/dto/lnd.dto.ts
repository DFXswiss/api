export interface LndInfoDto {
  version: string;
  identity_pubkey: string;
  num_active_channels: number;
  block_height: number;
  synced_to_chain: boolean;
}

export interface LndWalletBalanceDto {
  total_balance: number;
  confirmed_balance: number;
  unconfirmed_balance: number;
  locked_balance: number;
}

export interface LndChannelBalanceDto {
  balance: number;
  pending_open_balance: number;
  local_balance: { sat: number };
  remote_balance: { sat: number };
}

export enum LndPaymentStatus {
  UNKNOWN = 'UNKNOWN',
  IN_FLIGHT = 'IN_FLIGHT',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export interface LndPaymentsDto {
  payments: LndPaymentDto[];
}

export interface LndPaymentDto {
  payment_hash: string;
  value_sat: number;
  fee_sat: number;
  creation_date: number;
  payment_request: string;
  status: LndPaymentStatus;
}

export interface LndSendPaymentResponseDto {
  payment_hash: string;
  payment_error: string;
}
