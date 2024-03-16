import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from 'src/subdomains/supporting/fiat-payin/entities/checkout-tx.entity';
import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { TransactionSourceType, TransactionTypeInternal } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  sourceType: TransactionSourceType;
  created?: Date;
  type?: TransactionTypeInternal;
  buyCrypto?: BuyCrypto;
  buyFiat?: BuyFiat;
  bankTxReturn?: BankTxReturn;
  bankTxRepeat?: BankTxRepeat;
  refReward?: RefReward;
  bankTx?: BankTx;
  checkoutTx?: CheckoutTx;
  cryptoInput?: CryptoInput;
}
