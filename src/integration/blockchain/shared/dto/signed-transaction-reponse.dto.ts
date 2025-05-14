import { TransactionResponse } from 'alchemy-sdk';

export type SignedTransactionResponse = EvmSignedTransactionResponse | SolanaSignedTransactionResponse;

export interface EvmSignedTransactionResponse {
  response?: TransactionResponse;
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
