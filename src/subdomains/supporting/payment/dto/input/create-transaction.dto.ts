import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { TransactionSourceType, TransactionTypeInternal } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  sourceType: TransactionSourceType;
  created?: Date;
  type?: TransactionTypeInternal;
  buyCrypto?: BuyCrypto;
  buyFiat?: BuyFiat;
  bankTxReturn?: BankTxReturn;
  bankTxRepeat?: BankTxRepeat;
  user?: User;
  userData?: UserData;
}
