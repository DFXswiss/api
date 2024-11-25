import { TransactionResponse } from 'alchemy-sdk';

export interface SignedTransactionResponse {
  response?: TransactionResponse;
  error?: {
    code: number;
    message: string;
  };
}
