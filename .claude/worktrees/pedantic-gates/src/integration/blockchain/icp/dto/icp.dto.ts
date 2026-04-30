export interface IcpTransfer {
  blockIndex: number;
  from: string;
  to: string;
  amount: number;
  fee: number;
  memo: bigint;
  timestamp: number;
}

export interface IcpTransferQueryResult {
  transfers: IcpTransfer[];
  lastBlockIndex: number;
  chainLength: number;
  rawTransactionCount: number;
}

// --- Candid query_blocks response types (ICP native ledger) ---

export interface CandidQueryBlocksResponse {
  chain_length: bigint;
  blocks: CandidBlock[];
  first_block_index: bigint;
}

export interface CandidBlock {
  transaction: {
    memo: bigint;
    operation: CandidOperation[];
  };
  timestamp: { timestamp_nanos: bigint };
}

export type CandidOperation =
  | { Transfer: { from: Uint8Array; to: Uint8Array; amount: { e8s: bigint }; fee: { e8s: bigint } } }
  | { Mint: { to: Uint8Array; amount: { e8s: bigint } } }
  | { Burn: { from: Uint8Array; amount: { e8s: bigint } } }
  | { Approve: { from: Uint8Array; spender: Uint8Array; allowance: { e8s: bigint }; fee: { e8s: bigint } } };

// --- Candid ICRC-3 response types (ck-token canisters) ---

export interface CandidIcrcAccount {
  owner: { toText(): string };
  subaccount: Uint8Array[];
}

export interface CandidIcrcTransfer {
  from: CandidIcrcAccount;
  to: CandidIcrcAccount;
  amount: bigint;
  fee: bigint[];
  memo: Uint8Array[];
  created_at_time: bigint[];
  spender: CandidIcrcAccount[];
}

export interface CandidIcrcTransaction {
  kind: string;
  transfer: CandidIcrcTransfer[];
  timestamp: bigint;
}

export interface CandidIcrcGetTransactionsResponse {
  first_index: bigint;
  log_length: bigint;
  transactions: CandidIcrcTransaction[];
}

// --- Rosetta API response types ---

export interface RosettaTransactionsResponse {
  transactions: RosettaTransactionEntry[];
  total_count: number;
  next_offset?: number;
}

export interface RosettaTransactionEntry {
  block_identifier: { index: number; hash: string };
  transaction: {
    transaction_identifier: { hash: string };
    operations: RosettaOperation[];
    metadata: { block_height: number; memo: number; timestamp: number };
  };
}

export interface RosettaOperation {
  operation_identifier: { index: number };
  type: string;
  status: string;
  account: { address: string };
  amount?: { value: string; currency: { symbol: string; decimals: number } };
}

// --- Typed raw ledger interfaces (for Actor.createActor results) ---

export interface IcpNativeRawLedger {
  query_blocks(params: { start: bigint; length: bigint }): Promise<CandidQueryBlocksResponse>;
}

export interface IcrcRawLedger {
  get_transactions(params: { start: bigint; length: bigint }): Promise<CandidIcrcGetTransactionsResponse>;
}
