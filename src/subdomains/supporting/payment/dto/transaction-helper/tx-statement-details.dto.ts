import { BankInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/buy-payment-info.dto';
import { Transaction } from '../../entities/transaction.entity';
import { TransactionType } from '../transaction.dto';

export enum TxStatementType {
  INVOICE = 'Invoice',
  RECEIPT = 'Receipt',
}

export interface TxStatementDetails {
  statementType: TxStatementType;
  transactionType: TransactionType;
  transaction: Transaction;
  currency: string;
  bankInfo?: BankInfoDto;
  reference?: string;
}
