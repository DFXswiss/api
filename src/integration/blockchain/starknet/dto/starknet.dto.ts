export interface StarknetTransactionDto {
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  from: string;
  fee: number;
  destinations: StarknetTransactionDestinationDto[];
  status: string;
}

export interface StarknetTransactionDestinationDto {
  to: string;
  amount: number;
  tokenInfo?: {
    address: string;
    decimals: number;
  };
}
