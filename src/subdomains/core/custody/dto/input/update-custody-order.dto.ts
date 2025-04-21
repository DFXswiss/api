import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';

export class UpdateCustodyOrderInternalDto {
  transactionRequest?: TransactionRequest;
  transaction?: Transaction;
  inputAmount?: number;
  outputAmount?: number;
}
