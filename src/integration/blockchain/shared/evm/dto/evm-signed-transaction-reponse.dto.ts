import { TransactionResponse } from 'alchemy-sdk';

export interface EvmSignedTransactionResponse {
  response?: TransactionResponse;
  error?: {
    code: number;
    message: string;
  };
}
