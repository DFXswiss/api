import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { FiatOutput } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { BankExchangeType } from 'src/subdomains/supporting/log/dto/log.dto';
import { FiatPaymentMethod, PaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import {
  SpecialExternalAccount,
  SpecialExternalAccountType,
} from '../../../payment/entities/special-external-account.entity';
import { Transaction } from '../../../payment/entities/transaction.entity';
import { BankTxRepeat } from '../../bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from '../../bank-tx-return/bank-tx-return.entity';
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
  SCB = 'SCB',
  CHECKOUT_LTD = 'CheckoutLtd',
  REVOLUT_CARD_PAYMENT = 'RevolutCardPayment',
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
  highRisk?: boolean;

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
  chargeAmount?: number;

  @Column({ length: 256, nullable: true })
  chargeCurrency?: string;

  @Column({ type: 'float', nullable: true })
  chargeAmountChf?: number;

  @Column({ type: 'float', nullable: true })
  senderChargeAmount?: number;

  @Column({ length: 256, nullable: true })
  senderChargeCurrency?: string;

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

  @Column({ length: 256, nullable: true })
  senderAccount?: string;

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
  type?: BankTxType;

  @ManyToOne(() => BankTxBatch, (batch) => batch.transactions, { nullable: true })
  batch?: BankTxBatch;

  @OneToOne(() => BankTxReturn, (bankTxReturn) => bankTxReturn.bankTx, { nullable: true })
  bankTxReturn?: BankTxReturn;

  @OneToOne(() => BankTxRepeat, (bankTxRepeat) => bankTxRepeat.bankTx, { nullable: true })
  bankTxRepeat?: BankTxRepeat;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.bankTx, { nullable: true })
  buyCrypto?: BuyCrypto;

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.chargebackBankTx, { nullable: true })
  buyCryptoChargeback?: BuyCrypto;

  @OneToMany(() => BuyFiat, (buyFiat) => buyFiat.bankTx, { nullable: true })
  buyFiats?: BuyFiat[];

  @OneToOne(() => Transaction, { nullable: true })
  @JoinColumn()
  transaction?: Transaction;

  @OneToOne(() => FiatOutput, (fiatOutput) => fiatOutput.bankTx, { nullable: true })
  fiatOutput?: FiatOutput;

  //*** GETTER METHODS ***//

  get user(): User {
    return this.buyCrypto?.user ?? this.buyCryptoChargeback?.user ?? this.buyFiats?.[0]?.user;
  }

  get paymentMethodIn(): PaymentMethod {
    return FiatPaymentMethod.BANK;
  }

  get chargebackBankFee(): number {
    return this.chargeAmount ?? 0;
  }

  get refundAmount(): number {
    return this.amount + this.chargebackBankFee;
  }

  get feeAmountChf(): number {
    return this.chargeAmountChf;
  }

  get txInfoName(): string {
    if (
      !this.txInfo ||
      this.remittanceInfo === this.txInfo ||
      this.txInfo.includes(this.name) ||
      this.txInfo.includes('Gutschrift SWIFT') ||
      this.txInfo.includes('Vrt SEPA Recu') ||
      this.txInfo.includes('Vrt INST Recu') ||
      this.txInfo.split(' ')[0].length === 14 || // bankUsage
      this.ultimateName ||
      this.creditDebitIndicator === BankTxIndicator.DEBIT
    )
      return undefined;

    return this.txInfo
      .replace(/Übertrag/g, '')
      .replace(/Gutschrift/g, '')
      .replace(/Bankenclearing-Vergütung/g, '')
      .replace(/Storno PAIN-Auftrag/g, '')
      .replace(/PAIN-Auftrag/g, '')
      .replace(/Postgiro/g, '')
      .trim();
  }

  completeName(multiAccountName?: string): string {
    const regex = multiAccountName ? new RegExp(`${multiAccountName}|,`, 'g') : /[,]/g;
    return [this.name, this.ultimateName, this.txInfoName]
      .filter((n) => n && ![multiAccountName, 'Schaltereinzahlung'].includes(n))
      .map((n) =>
        n
          .replace(regex, '')
          .replace(/NOTPROVIDED/g, '')
          .trim(),
      )
      .join(' ');
  }

  bankDataName(multiAccounts: SpecialExternalAccount[]): string | undefined {
    if (Util.isSameName(this.name, this.ultimateName)) return this.name.replace(/[,]/g, '').trim();

    const multiAccount = multiAccounts.find(
      (m) =>
        (m.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN && m.value === this.iban) ||
        (m.type === SpecialExternalAccountType.MULTI_ACCOUNT_BANK_NAME &&
          (this.name?.includes(m.value) || this.ultimateName?.includes(m.value))),
    );

    return this.completeName(multiAccount?.name);
  }

  getSenderAccount(multiAccounts: SpecialExternalAccount[]): string | undefined {
    if (this.iban) {
      if (
        multiAccounts.some(
          (m) =>
            (m.type === SpecialExternalAccountType.MULTI_ACCOUNT_IBAN && m.value === this.iban) ||
            (m.type === SpecialExternalAccountType.MULTI_ACCOUNT_BANK_NAME &&
              (this.name?.includes(m.value) || this.ultimateName?.includes(m.value))),
        )
      )
        return `${this.iban};${this.completeName().replace(/ /g, '')}`;

      if (!isNaN(+this.iban)) return `NOIBAN${this.iban};${this.completeName().replace(/ /g, '')}`;
      return this.iban;
    }

    if (this.name) {
      if (this.name.startsWith('/C/')) return this.name.split('/C/')[1];
      if (this.name === 'Schaltereinzahlung') return `${this.name};${this.ultimateName?.replace(/ /g, '')}`;
    }

    if (this.completeName()) {
      return this.completeName().replace(/ /g, ':');
    }
  }

  reset(): UpdateResult<BankTx> {
    const update: Partial<BankTx> = {
      remittanceInfo: null,
      type: BankTxType.GSHEET,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  pendingInputAmount(asset: Asset): number {
    if (this.type && ![BankTxType.PENDING, BankTxType.GSHEET, BankTxType.UNKNOWN].includes(this.type)) return 0;

    switch (asset.blockchain as string) {
      case 'MaerkiBaumann':
      case 'Olkypay':
        return BankService.isBankMatching(asset, this.accountIban) ? this.amount : 0;

      default:
        return 0;
    }
  }

  pendingOutputAmount(_: Asset): number {
    return 0;
  }

  pendingBankAmount(asset: Asset, type: BankExchangeType, sourceIban?: string, targetIban?: string): number {
    if (this.instructedCurrency !== asset.dexName) return 0;

    switch (type) {
      case BankTxType.INTERNAL:
        if (!BankService.isBankMatching(asset, targetIban)) return 0;

        return this.iban === targetIban && this.accountIban === sourceIban
          ? this.instructedAmount
          : this.iban === sourceIban && this.accountIban === targetIban
          ? -this.instructedAmount
          : 0;

      case BankTxType.KRAKEN:
        if (
          !BankService.isBankMatching(asset, targetIban ?? this.accountIban) ||
          (targetIban && asset.dexName !== this.instructedCurrency)
        )
          return 0;

        return this.creditDebitIndicator === BankTxIndicator.CREDIT ? -this.instructedAmount : this.instructedAmount;

      default:
        return 0;
    }
  }
}

export const BankTxCompletedTypes = [
  BankTxType.BUY_CRYPTO,
  BankTxType.BUY_FIAT,
  BankTxType.BANK_TX_REPEAT,
  BankTxType.BANK_TX_RETURN,
];

export function BankTxTypeCompleted(bankTxType?: BankTxType): boolean {
  return BankTxCompletedTypes.includes(bankTxType);
}

export const BankTxUnassignedTypes = [BankTxType.GSHEET, BankTxType.UNKNOWN, BankTxType.PENDING];

export function BankTxTypeUnassigned(bankTxType?: BankTxType): boolean {
  return BankTxUnassignedTypes.includes(bankTxType);
}
