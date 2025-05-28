import { TransactionResponse } from 'alchemy-sdk';

export type SignedTransactionResponse =
  | EvmSignedTransactionResponse
  | BitcoinSignedTransactionResponse
  | SolanaSignedTransactionResponse;

export interface EvmSignedTransactionResponse {
  response?: TransactionResponse;
  error?: {
    code: number;
    message: string;
  };
}

export interface BitcoinSignedTransactionResponse {
  hash?: string;
  error?: {
    code: number;
    message: string;
  };
}

export interface SolanaSignedTransactionResponse {
  hash?: string;
  error?: {
    code: number;
    message: string;
  };
}
