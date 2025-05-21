export class SolanaToken {
  readonly isNative = false;
  readonly isToken = true;

  constructor(readonly address: string, readonly decimals: number) {}
}

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
  from: string[];
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

export interface SolanaNativeInstructionsDto {
  destination: string;
  source: string;
  lamports: number;
}

export interface SolanaTokenInstructionsDto {
  destination: string;
  source: string;
  mint: string;
  amount: string;
  decimals: number;
  authority: string;
}
