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

export interface StarknetTokenDto {
  address: string;
  contractAddress: string;
  owner: string;
  amount: number;
  decimals: number;
}
