import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, OneToOne } from 'typeorm';
import { BuyCrypto } from '../../../core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from '../../../core/sell-crypto/process/buy-fiat.entity';
import { BankTx } from '../../bank-tx/bank-tx/bank-tx.entity';
import { CheckoutTx } from '../../fiat-payin/entities/checkout-tx.entity';
import { CryptoInput } from '../../payin/entities/crypto-input.entity';

export enum TransactionType {
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
  INTERNAL = 'Internal',
  RETURN = 'Return',
  REPEAT = 'Repeat',
}

export enum TransactionSourceType {
  BANK_TX = 'BankTx',
  CRYPTO_INPUT = 'CryptoInput',
  CHECKOUT_TX = 'CheckoutTx',
}

@Entity()
export class Transaction extends IEntity {
  @Column({ type: 'integer' })
  sourceId: number;

  @Column({ length: 256 })
  sourceType: TransactionSourceType;

  @Column({ length: 256, nullable: true })
  type?: TransactionType;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.transaction, { eager: true, nullable: true })
  buyCrypto: BuyCrypto;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.transaction, { eager: true, nullable: true })
  buyFiat: BuyFiat;

  @OneToOne(() => CryptoInput, (cryptoInput) => cryptoInput.transaction, { eager: true, nullable: true })
  cryptoInput: CryptoInput;

  @OneToOne(() => CheckoutTx, (checkoutTx) => checkoutTx.transaction, { eager: true, nullable: true })
  checkoutTx: CheckoutTx;

  @OneToOne(() => BankTx, (bankTx) => bankTx.transaction, { eager: true, nullable: true })
  bankTx: BankTx;
}
