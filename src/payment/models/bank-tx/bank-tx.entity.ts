import { Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Column, ManyToOne } from 'typeorm';
import { BankTxBatch } from './bank-tx-batch.entity';

@Entity()
export class BankTx {
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

  // related party info
  @Column({ length: 256, nullable: true })
  name?: string;

  @Column({ length: 256, nullable: true })
  ultimateName?: string;

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

  @ManyToOne(() => BankTxBatch, (batch) => batch.transactions, { nullable: false })
  batch: BankTxBatch;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
