import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { BankTxReturn } from '../bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';

export enum TransactionCharge {
  BEN = 'BEN',
  OUR = 'OUR',
  SHA = 'SHA',
}

export enum FiatOutputType {
  BUY_FIAT = 'BuyFiat',
  BUY_CRYPTO_FAIL = 'BuyCryptoFail',
  LIQ_MANAGEMENT = 'LiqManagement',
  BANK_TX_RETURN = 'BankTxReturn',
  BANK_TX_REPEAT = 'BankTxRepeat',
  MANUAL = 'Manual',
  TALIUM_BUY_CRYPTO = 'TaliumBuyCrypto',
}

@Entity()
export class FiatOutput extends IEntity {
  @OneToMany(() => BuyFiat, (buyFiat) => buyFiat.fiatOutput, { nullable: true })
  buyFiats?: BuyFiat[];

  @OneToOne(() => BuyCrypto, (buyCrypto) => buyCrypto.chargebackOutput, { nullable: true })
  buyCrypto?: BuyCrypto;

  @OneToOne(() => BankTxReturn, (bankTxReturn) => bankTxReturn.chargebackOutput, { nullable: true })
  bankTxReturn?: BankTxReturn;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  bankTx?: BankTx;

  @Column({ length: 256 })
  type: FiatOutputType;

  @Column({ type: 'integer', nullable: true })
  originEntityId?: number;

  @Column({ length: 256, nullable: true })
  accountIban?: string;

  @Column({ type: 'integer', nullable: true })
  batchId?: number;

  @Column({ type: 'float', nullable: true })
  batchAmount?: number;

  @Column({ length: 256, nullable: true })
  charge?: TransactionCharge;

  @Column({ default: false })
  isInstant?: boolean;

  @Column({ type: 'datetime2', nullable: true })
  valutaDate?: Date;

  @Column({ nullable: true })
  currency?: string;

  @Column({ type: 'float', nullable: true })
  amount?: number;

  @Column({ length: 256, nullable: true })
  remittanceInfo?: string;

  @Column({ type: 'integer', nullable: true })
  accountNumber?: number;

  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  address?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @Column({ length: 256, nullable: true })
  city?: string;

  @Column({ length: 256, nullable: true })
  country?: string;

  @Column({ length: 256, nullable: true })
  iban?: string;

  @Column({ length: 256, nullable: true })
  aba?: string;

  @Column({ length: 256, nullable: true })
  bic?: string;

  @Column({ length: 256, nullable: true })
  creditInstitution?: string;

  @Column({ length: 256, nullable: true })
  pmtInfId?: string;

  @Column({ length: 256, nullable: true })
  instrId?: string;

  @Column({ length: 256, nullable: true })
  endToEndId?: string;

  @Column({ type: 'datetime2', nullable: true })
  isReadyDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isTransmittedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isConfirmedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  isApprovedDate?: Date;

  @Column({ default: false })
  isComplete?: boolean;

  @Column({ length: 256, nullable: true })
  info?: string;

  @Column({ type: 'datetime2', nullable: true })
  outputDate?: Date;

  @Column({ nullable: true })
  reportCreated?: boolean;

  // --- ENTITY METHODS --- //

  setBatch(batchId?: number, batchAmount?: number): UpdateResult<FiatOutput> {
    const update: Partial<FiatOutput> = { batchId, batchAmount: Math.round(batchAmount) };

    Object.assign(this, update);

    return [this.id, update];
  }

  get ibanCountry(): string {
    return (
      this.buyCrypto?.chargebackIban ??
      this.buyFiats?.[0]?.sell?.iban ??
      this.bankTxReturn?.chargebackIban
    )?.substring(0, 2);
  }

  get bankAccountCurrency(): string {
    const currency =
      this.buyCrypto?.bankTx?.currency ??
      this.buyFiats?.[0]?.sell?.fiat?.name ??
      this.bankTxReturn?.bankTx?.currency ??
      this.currency;
    return ['LI', 'CH'].includes(this.ibanCountry) && currency === 'CHF' ? currency : 'EUR';
  }

  get bankAmount(): number {
    return this.bankAccountCurrency === this.currency || !this.originEntity
      ? this.amount
      : this.bankAccountCurrency === 'CHF'
      ? this.originEntity.amountInChf
      : this.originEntity.amountInEur;
  }

  get originEntity(): BuyCrypto | BuyFiat | BankTxReturn | undefined {
    return this.buyCrypto ?? this.buyFiats[0] ?? this.bankTxReturn;
  }

  get user(): User | undefined {
    return this.buyCrypto?.user ?? this.buyFiats[0]?.user;
  }

  get userData(): UserData | undefined {
    return this.originEntity?.userData;
  }
}
