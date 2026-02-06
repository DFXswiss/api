export interface CardanoInfoResponse {
  testnet: boolean;
  tip: number;
}

export interface CardanoBalanceResponse {
  value: string;
  currency: {
    symbol: string;
    decimals: number;
  };
}

export interface CardanoBlockResponse {
  hash: string;
  number: number;
  epochNo: number;
  slotNo: number;
  forgedAt: string;
}

export interface CardanoTransactionResponse {
  hash: string;
  fee: string;
  block: {
    hash: string;
    number: number;
    blocktimeMillis?: number;
  };
  inputs: CardanoTransactionResponseInput[];
  outputs: CardanoTransactionResponseOutput[];
}

export interface CardanoTransactionResponseInput {
  txHash: string;
  address: string;
  symbol: string;
  value: string;
}

export interface CardanoTransactionResponseOutput {
  txHash: string;
  address: string;
  symbol: string;
  value: string;
  index: number;
}

export interface CardanoUtxoReponse {
  txHash: string;
  index: string;
  address: string;
  value: string;
}

export interface CardanoTransactionDto {
  blockNumber: number;
  blocktimeMillis: number;
  txId: string;
  fee: number;
  from: string;
  to: string;
  amount: number;
  tokenAddress?: string;
}
