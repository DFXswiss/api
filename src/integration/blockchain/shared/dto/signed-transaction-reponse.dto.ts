import { TransactionResponse } from 'alchemy-sdk';

export type SignedTransactionResponse = EvmSignedTransactionResponse | BlockchainSignedTransactionResponse;

export interface EvmSignedTransactionResponse {
  response?: TransactionResponse;
  error?: {
    code: number;
    message: string;
  };
}

export interface BlockchainSignedTransactionResponse {
  hash?: string;
  error?: {
    code?: number;
    message: string;
  };
}
