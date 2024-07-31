import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { BuyCrypto } from '../../../core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../../core/sell-crypto/process/buy-fiat.entity';
import { BankTxRepeat } from '../../bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from '../../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from '../../bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { MailContext } from '../../notification/enums';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';
import { SupportIssue } from '../../support-issue/entities/support-issue.entity';
import { TransactionRequest } from './transaction-request.entity';

export enum TransactionTypeInternal {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
  BUY_FIAT_OUTPUT = 'BuyFiatOutput',
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

  @Column({ length: 256, nullable: true })
  externalId: string;

  // Mail
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate: Date;

  // References
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

  @OneToOne(() => TransactionRequest, { nullable: true })
  @JoinColumn()
  request: TransactionRequest;

  // --- ENTITY METHODS --- //

  mailSent(recipientMail?: string): UpdateResult<Transaction> {
    const update: Partial<BuyCrypto> = {
      recipientMail: recipientMail ?? this.userData?.mail,
      mailSendDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get url(): string {
    return `${Config.frontend.services}/tx/${this.uid}`;
  }

  get mailContext(): MailContext | undefined {
    return this.buyCrypto ? MailContext.BUY_CRYPTO : this.buyFiat ? MailContext.BUY_FIAT : undefined;
  }

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

  get userData(): UserData {
    return this.user?.userData;
  }
}
