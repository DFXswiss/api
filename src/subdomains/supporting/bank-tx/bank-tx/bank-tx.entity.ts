import { IEntity } from 'src/shared/models/entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { Column, Entity, ManyToOne, OneToOne } from 'typeorm';
import { BankTxReturn } from '../bank-tx-return/bank-tx-return.entity';
import { BankTxBatch } from './bank-tx-batch.entity';

export enum BankTxType {
  INTERNAL = 'Internal',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  BANK_TX_RETURN = 'BankTxReturn',
  BANK_TX_RETURN_CHARGEBACK = 'BankTxReturn-Chargeback',
  BANK_TX_REPEAT = 'BankTxRepeat',
  BANK_TX_REPEAT_CHARGEBACK = 'BankTxRepeat-Chargeback',
  BUY_CRYPTO = 'BuyCrypto',
  BUY_FIAT = 'BuyFiat',
  FIAT_FIAT = 'FiatFiat',
  TEST_FIAT_FIAT = 'TestFiatFiat',
  GSHEET = 'GSheet',
  KRAKEN = 'Kraken',
  CHECKOUT_LTD = 'CheckoutLtd',
  BANK_ACCOUNT_FEE = 'BankAccountFee',
  EXTRAORDINARY_EXPENSES = 'ExtraordinaryExpenses',
  PENDING = 'Pending',
  UNKNOWN = 'Unknown',
}

export enum BankTxIndicator {
  CREDIT = 'CRDT',
  DEBIT = 'DBIT',
}

@Entity()
export class BankTx extends IEntity {
  @Column({ length: 256, unique: true })
  accountServiceRef: string;

  @Column({ type: 'datetime2', nullable: true })
  bookingDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  valueDate?: Date;

  @Column({ type: 'integer', nullable: true })
  txCount?: number;

  @Column({ length: 256, nullable: true })
  endToEndId?: string;

  @Column({ length: 256, nullable: true })
  instructionId?: string;

  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ nullable: true })
  highRisk: boolean;

  // amounts
  @Column({ type: 'float', nullable: true })
  amount?: number;

  @Column({ length: 256, nullable: true })
  currency?: string;

  @Column({ length: 256, nullable: true })
  creditDebitIndicator?: string;

  @Column({ type: 'float', nullable: true })
  instructedAmount?: number;

  @Column({ length: 256, nullable: true })
  instructedCurrency?: string;

  @Column({ type: 'float', nullable: true })
  txAmount?: number;

  @Column({ length: 256, nullable: true })
  txCurrency?: string;

  @Column({ length: 256, nullable: true })
  exchangeSourceCurrency?: string;

  @Column({ length: 256, nullable: true })
  exchangeTargetCurrency?: string;

  @Column({ type: 'float', nullable: true })
  exchangeRate?: number;

  @Column({ type: 'float', nullable: true })
  chargeAmount: number;

  @Column({ length: 256, nullable: true })
  chargeCurrency: string;

  @Column({ type: 'float', nullable: true })
  accountingAmountBeforeFee?: number;

  @Column({ type: 'float', nullable: true })
  accountingFeeAmount?: number;

  @Column({ type: 'float', nullable: true })
  accountingFeePercent?: number;

  @Column({ type: 'float', nullable: true })
  accountingAmountAfterFee?: number;

  @Column({ type: 'float', nullable: true })
  accountingAmountBeforeFeeChf?: number;

  @Column({ type: 'float', nullable: true })
  accountingAmountAfterFeeChf?: number;

  // related party info
  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  addressLine1?: string;

  @Column({ length: 256, nullable: true })
  addressLine2?: string;

  @Column({ length: 256, nullable: true })
  country?: string;

  @Column({ length: 256, nullable: true })
  ultimateName?: string;

  @Column({ length: 256, nullable: true })
  ultimateAddressLine1?: string;

  @Column({ length: 256, nullable: true })
  ultimateAddressLine2?: string;

  @Column({ length: 256, nullable: true })
  ultimateCountry?: string;

  @Column({ length: 256, nullable: true })
  iban?: string;

  @Column({ length: 256, nullable: true })
  accountIban?: string;

  // related bank info
  @Column({ length: 256, nullable: true })
  bic?: string;

  @Column({ length: 256, nullable: true })
  clearingSystemId?: string;

  // bank account number like IBAN
  @Column({ length: 256, nullable: true })
  memberId?: string;

  @Column({ length: 256, nullable: true })
  bankName?: string;

  @Column({ length: 256, nullable: true })
  bankAddressLine1?: string;

  @Column({ length: 256, nullable: true })
  bankAddressLine2?: string;

  @Column({ length: 256, nullable: true })
  remittanceInfo?: string;

  @Column({ length: 256, nullable: true })
  txInfo?: string;

  @Column({ length: 'MAX', nullable: true })
  txRaw?: string;

  // routing id for american banks
  @Column({ length: 256, nullable: true })
  aba?: string;

  @Column({ length: 256, nullable: true })
  type: BankTxType;

  @ManyToOne(() => BankTxBatch, (batch) => batch.transactions, { nullable: true })
  batch: BankTxBatch;

  @OneToOne(() => BankTxReturn, (bankTxReturn) => bankTxReturn.bankTx, { nullable: true })
  bankTxReturn?: BankTxReturn;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.bankTx, { nullable: true })
  buyCrypto?: BuyCrypto;

  @OneToOne(() => BuyFiat, (buyFiat) => buyFiat.bankTx, { nullable: true })
  buyFiat?: BuyFiat;
}

export const BankTxCompletedTypes = [BankTxType.BUY_CRYPTO, BankTxType.BANK_TX_REPEAT, BankTxType.BANK_TX_RETURN];

export function BankTxTypeCompleted(bankTxType?: BankTxType): boolean {
  return BankTxCompletedTypes.includes(bankTxType);
}
