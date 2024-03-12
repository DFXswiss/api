import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { TransactionSourceType, TransactionTypeInternal } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  sourceType: TransactionSourceType;
  type?: TransactionTypeInternal;
  buyCrypto?: BuyCrypto;
  buyFiat?: BuyFiat;
  bankTxReturn?: BankTxReturn;
  bankTxRepeat?: BankTxRepeat;
  refReward?: RefReward;
}
