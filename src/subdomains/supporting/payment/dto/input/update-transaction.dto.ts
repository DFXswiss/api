import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionRequest } from '../../entities/transaction-request.entity';
import { TransactionTypeInternal } from '../../entities/transaction.entity';

export class UpdateTransactionDto {
  type: TransactionTypeInternal;
  request?: TransactionRequest;
  user?: User;
  resetMailSendDate?: boolean;
}
