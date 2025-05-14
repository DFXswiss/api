export interface SolanaTokenDto {
  address: string;
  mint: string;
  owner: string;
  amount: number;
  decimals: number;
}

export interface SolanaTransactionDto {
  slotNumber: number;
  blocktime: number;
  txid: string;
  from: string;
  fee: number;
  destinations: SolanaTransactionDestinationDto[];
}

export interface SolanaTransactionDestinationDto {
  to: string;
  amount: number;
  tokenInfo?: {
    address: string;
    decimals: number;
  };
}
