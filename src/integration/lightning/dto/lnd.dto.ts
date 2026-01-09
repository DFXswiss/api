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

export enum LndInvoiceState {
  OPEN = 'OPEN',
  SETTLED = 'SETTLED',
  CANCELED = 'CANCELED',
  ACCEPTED = 'ACCEPTED',
}

export interface LndInvoiceDto {
  memo: string;
  r_hash: string;
  payment_request: string;
  value_sat: string;
  state: LndInvoiceState;
  settled: boolean;
  settle_date: string;
  amt_paid_sat: string;
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

export interface LndChannelDto {
  active: boolean;
  remote_pubkey: string;
  channel_point: string;
  chan_id: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
  commit_fee: string;
  commit_weight: string;
  fee_per_kw: string;
  unsettled_balance: string;
  total_satoshis_sent: string;
  total_satoshis_received: string;
  num_updates: string;
  pending_htlcs: [];
  csv_delay: number;
  private: boolean;
  initiator: boolean;
  chan_status_flags: string;
  local_chan_reserve_sat: string;
  remote_chan_reserve_sat: string;
  static_remote_key: boolean;
  commitment_type: string;
  lifetime: string;
  uptime: string;
  close_address: string;
  push_amount_sat: string;
  thaw_height: number;
  local_constraints: {
    csv_delay: number;
    chan_reserve_sat: string;
    dust_limit_sat: string;
    max_pending_amt_msat: string;
    min_htlc_msat: string;
    max_accepted_htlcs: number;
  };
  remote_constraints: {
    csv_delay: number;
    chan_reserve_sat: string;
    dust_limit_sat: string;
    max_pending_amt_msat: string;
    min_htlc_msat: string;
    max_accepted_htlcs: number;
  };
  alias_scids: [];
  zero_conf: boolean;
  zero_conf_confirmed_scid: string;
  peer_alias: string;
  peer_scid_alias: string;
}

export interface LndRouteDto {
  total_fees_msat: number;
  total_amt_msat: number;
  hops: [
    {
      chan_id: string;
      amt_to_forward_msat: number;
      fee_msat: number;
      pub_key: string;
    },
  ];
}
