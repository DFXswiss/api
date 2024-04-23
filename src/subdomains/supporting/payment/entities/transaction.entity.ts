import { IEntity } from 'src/shared/models/entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BuyCrypto } from '../../../core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../../core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from '../../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from '../../bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { SupportIssue } from '../../support-issue/support-issue.entity';

export enum TransactionTypeInternal {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
  CRYPTO_CRYPTO = 'CryptoCrypto',
  INTERNAL = 'Internal',
  BANK_TX_RETURN = 'BankTxReturn',
  BANK_TX_REPEAT = 'BankTxRepeat',
  CRYPTO_INPUT_RETURN = 'CryptoInputReturn',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  REF_REWARD = 'RefReward',
}

export enum TransactionSourceType {
  BANK_TX = 'BankTx',
  CRYPTO_INPUT = 'CryptoInput',
  CHECKOUT_TX = 'CheckoutTx',
  REF = 'Ref',
}

@Entity()
export class Transaction extends IEntity {
  @Column({ length: 256 })
  sourceType: TransactionSourceType;

  @Column({ length: 256, nullable: true })
  type: TransactionTypeInternal;

  @Column({ length: 256, unique: true })
  uid: string;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.transaction, { nullable: true })
  buyCrypto: BuyCrypto;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.transaction, { nullable: true })
  buyFiat: BuyFiat;

  @OneToOne(() => BankTxReturn, (bankTxReturn) => bankTxReturn.transaction, { nullable: true })
  bankTxReturn: BankTxReturn;

  @OneToOne(() => BankTxRepeat, (bankTxRepeat) => bankTxRepeat.transaction, { nullable: true })
  bankTxRepeat: BankTxRepeat;

  @OneToOne(() => RefReward, (refReward) => refReward.transaction, { nullable: true })
  refReward: RefReward;

  @OneToOne(() => BankTx, (bankTx) => bankTx.transaction, { nullable: true })
  bankTx: BankTx;

  @OneToOne(() => CryptoInput, (cryptoInput) => cryptoInput.transaction, { nullable: true })
  cryptoInput: CryptoInput;

  @OneToOne(() => CheckoutTx, (checkoutTx) => checkoutTx.transaction, { nullable: true })
  checkoutTx: CheckoutTx;

  @OneToMany(() => SupportIssue, (supportIssue) => supportIssue.transaction)
  supportIssues: SupportIssue[];

  @ManyToOne(() => User, (user) => user.transactions, { nullable: true, eager: true })
  user: User;

  get sourceEntity(): BankTx | CryptoInput | CheckoutTx | RefReward {
    switch (this.sourceType) {
      case TransactionSourceType.BANK_TX:
        return this.bankTx;

      case TransactionSourceType.CHECKOUT_TX:
        return this.checkoutTx;

      case TransactionSourceType.CRYPTO_INPUT:
        return this.cryptoInput;

      case TransactionSourceType.REF:
        return this.refReward;
    }
  }

  get targetEntity(): BuyCrypto | BuyFiat | RefReward | undefined {
    return this.buyCrypto ?? this.buyFiat ?? this.refReward ?? undefined;
  }
}
