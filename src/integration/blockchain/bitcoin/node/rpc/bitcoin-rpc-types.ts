/**
 * Bitcoin Core RPC Type Definitions
 *
 * Minimal type definitions for the Bitcoin Core JSON-RPC methods used by DFX.
 * Based on Bitcoin Core 0.21.0+ API.
 */

// --- Blockchain Types --- //

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  chainwork: string;
  size_on_disk: number;
  pruned: boolean;
  warnings: string;
}

export interface Block {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash?: string;
  nextblockhash?: string;
  tx: string[];
}

// --- Transaction Types --- //

export interface WalletTransaction {
  txid: string;
  blockhash?: string;
  blockheight?: number;
  blockindex?: number;
  blocktime?: number;
  confirmations: number;
  time: number;
  timereceived: number;
  amount: number;
  fee?: number;
  details: WalletTransactionDetail[];
  hex: string;
}

export interface WalletTransactionDetail {
  address?: string;
  category: 'send' | 'receive' | 'generate' | 'immature' | 'orphan';
  amount: number;
  label?: string;
  vout: number;
  fee?: number;
}

export interface TransactionHistoryEntry {
  address: string;
  category: string;
  amount: number;
  label?: string;
  vout: number;
  confirmations: number;
  blockhash?: string;
  blockheight?: number;
  blockindex?: number;
  blocktime?: number;
  txid: string;
  time: number;
  timereceived: number;
}

export interface MempoolEntry {
  vsize: number;
  weight: number;
  time: number;
  height: number;
  descendantcount: number;
  descendantsize: number;
  ancestorcount: number;
  ancestorsize: number;
  wtxid: string;
  fees: {
    base: number;
    modified: number;
    ancestor: number;
    descendant: number;
  };
  depends: string[];
  spentby: string[];
  'bip125-replaceable': boolean;
  unbroadcast: boolean;
}

export interface TestMempoolAcceptResult {
  txid: string;
  wtxid: string;
  allowed: boolean;
  vsize?: number;
  fees?: {
    base: number;
  };
  'reject-reason'?: string;
}

// --- Wallet Types --- //

export interface UTXO {
  txid: string;
  vout: number;
  address: string;
  label?: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
}

export interface WalletInfo {
  walletname: string;
  walletversion: number;
  format: string;
  balance: number;
  unconfirmed_balance: number;
  immature_balance: number;
  txcount: number;
  keypoololdest: number;
  keypoolsize: number;
  keypoolsize_hd_internal: number;
  unlocked_until?: number;
  paytxfee: number;
  hdseedid?: string;
  private_keys_enabled: boolean;
  avoid_reuse: boolean;
  scanning: boolean | { duration: number; progress: number };
  descriptors: boolean;
}

export interface SendResult {
  txid: string;
  complete: boolean;
}

// --- Fee Estimation Types --- //

export interface SmartFeeResult {
  feerate?: number;
  errors?: string[];
  blocks: number;
}

// --- Address Types --- //

export type AddressType = 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';

// --- RPC Configuration --- //

export interface BitcoinRpcConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  timeout?: number;
}

// --- RPC Response Types --- //

export interface RpcResponse<T> {
  result: T;
  error: RpcError | null;
  id: string | number;
}

export interface RpcError {
  code: number;
  message: string;
}
