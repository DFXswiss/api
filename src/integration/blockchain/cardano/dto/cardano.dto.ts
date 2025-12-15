export interface CardanoChainParameterDto {
  minFeeA: number; // Minimum fee coefficient per byte
  minFeeB: number; // Minimum fee constant
  minPoolCost: number;
  utxoCostPerByte: number;
}

export interface CardanoTransactionResponse {
  hash: string;
  block: number;
  block_time: number;
  slot: number;
  fees: string;
  deposit: string;
  size: number;
  invalid_before?: string;
  invalid_hereafter?: string;
  utxo_count: number;
  withdrawal_count: number;
  mir_cert_count: number;
  delegation_count: number;
  stake_cert_count: number;
  pool_update_count: number;
  pool_retire_count: number;
  asset_mint_or_burn_count: number;
  redeemer_count: number;
  valid_contract: boolean;
}

export interface CardanoTransactionDto {
  status: string;
  blockNumber: number;
  timestamp: number;
  txId: string;
  fee: number;
  from: string;
  to: string;
  amount: number;
  tokenAddress?: string;
}

export interface CardanoUtxoAmount {
  unit: string; // 'lovelace' or policy_id + asset_name
  quantity: string;
}

export interface CardanoUtxoInput {
  address: string;
  amount: CardanoUtxoAmount[];
  tx_hash: string;
  output_index: number;
  data_hash?: string;
  inline_datum?: string;
  reference_script_hash?: string;
  collateral: boolean;
  reference: boolean;
}

export interface CardanoUtxoOutput {
  address: string;
  amount: CardanoUtxoAmount[];
  output_index: number;
  data_hash?: string;
  inline_datum?: string;
  collateral: boolean;
  reference_script_hash?: string;
}

export interface CardanoTransactionUtxosResponse {
  hash: string;
  inputs: CardanoUtxoInput[];
  outputs: CardanoUtxoOutput[];
}
