// --- MONERO DAEMON --- //

// https://web.getmonero.org/resources/developer-guides/daemon-rpc.html#get_info
export interface GetInfoResultDto {
  status: string;
  height: number;
  synchronized: boolean;
  offline: boolean;
}

// https://web.getmonero.org/resources/developer-guides/daemon-rpc.html#get_fee_estimate
export enum BaseFeePriority {
  slow = 0,
  normal = 1,
  fast = 2,
  fastest = 3,
}

export interface GetFeeEstimateResultDto {
  fee: number;
  fees: number[];
  status: string;
}

// https://web.getmonero.org/resources/developer-guides/daemon-rpc.html#get_transactions
export interface GetTransactionResultDto {
  status: string;
  as_json?: string;
  block_height?: number;
  block_timestamp?: number;
  confirmations?: number;
  tx_hash?: string;
}

export interface MoneroTransactionDto {
  version?: number;
  unlock_time?: number;
  vin?: [MoneroTransactionVinDto];
  vout?: [MoneroTransactionVoutDto];
  extra?: [number];
  signatures?: [string];
  rct_signatures?: {
    type: number;
    txnFee: number;
  };

  block_height?: number;
  block_timestamp?: number;
  confirmations?: number;
  tx_hash?: string;
  inAmount?: number;
  outAmount?: number;
  txnFee?: number;
}

export interface MoneroTransactionVinDto {
  key: {
    amount: number;
    key_offsets: [number];
    k_image: string;
  };
}

export interface MoneroTransactionVoutDto {
  amount: number;
  target: {
    tagged_key: {
      key: string;
      view_tag: string;
    };
  };
}

// --- MONERO WALLET --- //

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#verify
export interface VerifyResultDto {
  good: boolean;
  old: boolean;
}

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#create_address
export interface AddressResultDto {
  address: string;
  address_index: number;
  label?: string;
  used?: boolean;
}

export interface GetAddressResultDto {
  address: string;
  addresses: [AddressResultDto];
}

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#get_balance
export interface GetBalanceResultDto {
  balance: number;
  unlocked_balance: number;
}

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#transfer
// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#get_transfers
export interface MoneroTransferDto {
  amount: number;
  fee: number;
  txid: string;

  // §2.3 native-first exactness (#4287 stage 3): the EXACT whole-unit XMR decimal STRING of `amount`, captured from the
  // raw atomic-unit (piconero, 12-dp) integer BEFORE the lossy auToXmr float collapse. undefined when unavailable
  // (atomic beyond the JSON safe-integer range) -> the ledger derives from the float (fail-open).
  amountExact?: string;

  timestamp?: number;
  address?: string;
  confirmations?: number;
  height?: number;

  destinations?: [
    {
      address: string;
      amount: number;
    },
  ];
}

export enum MoneroTransactionType {
  in = 'in',
  out = 'out',
  failed = 'failed',
  pending = 'pending',
  pool = 'pool',
}

export interface GetSendTransferResultDto {
  result?: {
    amount: number;
    fee: number;
    tx_hash: string;
    // only returned when the request sets get_tx_metadata
    tx_metadata?: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

// A transaction the wallet has built and signed but not relayed (`transfer` with do_not_relay, #4673).
// `metadata` is the wallet's tx_metadata blob and the input to the separate `relay_tx` call, which
// re-submits this exact transaction - so `txId` is already the final, durable id.
export interface MoneroSignedTxDto {
  txId: string;
  metadata: string;
}

export interface GetTransfersResultDto {
  in?: MoneroTransferDto[];
  out?: MoneroTransferDto[];
  failed?: MoneroTransferDto[];
  pending?: MoneroTransferDto[];
  pool?: MoneroTransferDto[];
}

export interface GetRelayTransactionResultDto {
  result?: {
    tx_hash: string;
  };
  error?: {
    code: number;
    message: string;
  };
}
