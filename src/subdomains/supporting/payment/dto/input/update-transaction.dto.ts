import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { TransactionTypeInternal } from '../../entities/transaction.entity';

export class UpdateTransactionDto {
  type: TransactionTypeInternal;
  user?: User;
}
