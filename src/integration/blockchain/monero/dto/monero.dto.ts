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
  slow,
  normal,
  fast,
  fastest,
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
  unlocked_balance: number;
}

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#transfer
export interface TransferResultDto {
  amount: number;
  fee: number;
  tx_hash: string;
}

// https://web.getmonero.org/resources/developer-guides/wallet-rpc.html#get_transfers
export interface GetTransfersResultDto {
  in: GetTransferInResultDto[];
}

export interface GetTransferInResultDto {
  timestamp: number;
  address: string;
  amount: number;
  confirmations: number;
  fee: number;
  height: number;
  txid: string;
}
