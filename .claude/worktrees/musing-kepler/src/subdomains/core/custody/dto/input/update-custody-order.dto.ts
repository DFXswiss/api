import { Asset } from 'src/shared/models/asset/asset.entity';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { CustodyOrderStatus } from '../../enums/custody';

export interface UpdateCustodyOrderInternalDto {
  status?: CustodyOrderStatus;
  transactionRequest?: TransactionRequest;
  transaction?: Transaction;
  inputAmount?: number;
  inputAsset?: Asset;
}
