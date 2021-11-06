import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column, ManyToOne } from 'typeorm';
import { FiatInputBatch } from './fiat-input-batch.entity';

@Entity()
export class FiatInput {
  @PrimaryGeneratedColumn()
  id: number;

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

  @Column({ length: 256, nullable: true })
  chargeCdi?: string;

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
  iban?: string;

  // related bank info
  @Column({ length: 256, nullable: true })
  bic?: string;

  @Column({ length: 256, nullable: true })
  clearingSystemId?: string;

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

  @ManyToOne(() => FiatInputBatch, (batch) => batch.fiatInputs, { nullable: false })
  batch: FiatInputBatch;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;

  // Robin's generic columns
  @Column({ length: 256, nullable: true })
  field1?: string;

  @Column({ length: 256, nullable: true })
  field2?: string;

  @Column({ length: 256, nullable: true })
  field3?: string;

  @Column({ length: 256, nullable: true })
  field4?: string;

  @Column({ length: 256, nullable: true })
  field5?: string;

  @Column({ length: 256, nullable: true })
  field6?: string;

  @Column({ length: 256, nullable: true })
  field7?: string;

  @Column({ length: 256, nullable: true })
  field8?: string;

  @Column({ length: 256, nullable: true })
  field9?: string;

  @Column({ length: 256, nullable: true })
  field10?: string;

  @Column({ length: 256, nullable: true })
  field11?: string;

  @Column({ length: 256, nullable: true })
  field12?: string;

  @Column({ length: 256, nullable: true })
  field13?: string;

  @Column({ length: 256, nullable: true })
  field14?: string;

  @Column({ length: 256, nullable: true })
  field15?: string;

  @Column({ length: 256, nullable: true })
  field16?: string;

  @Column({ length: 256, nullable: true })
  field17?: string;

  @Column({ length: 256, nullable: true })
  field18?: string;

  @Column({ length: 256, nullable: true })
  field19?: string;

  @Column({ length: 256, nullable: true })
  field20?: string;

  @Column({ length: 256, nullable: true })
  field21?: string;

  @Column({ length: 256, nullable: true })
  field22?: string;

  @Column({ length: 256, nullable: true })
  field23?: string;

  @Column({ length: 256, nullable: true })
  field24?: string;

  @Column({ length: 256, nullable: true })
  field25?: string;

  @Column({ length: 256, nullable: true })
  field26?: string;

  @Column({ length: 256, nullable: true })
  field27?: string;

  @Column({ length: 256, nullable: true })
  field28?: string;

  @Column({ length: 256, nullable: true })
  field29?: string;

  @Column({ length: 256, nullable: true })
  field30?: string;
}
