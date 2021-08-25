import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentType {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum PaymentError {
  NULL = '',
  IBAN = 'Iban',
  BANKUSAGE = 'Bankusage',
  FIAT = 'Fiat',
  ASSET = 'Asset',
  KYC = 'KYC',
  ACCOUNTCHECK = 'Account-check',
}

export enum PaymentStatus {
  UNPROCESSED = 'Unprocessed',
  PROCESSED = 'Processed',
  REPAYMENT = 'Repayment',
  CANCELED = 'Canceled'
}

@Entity()
export abstract class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256, nullable: true })
  address: string;

  @Column({ type: 'int', nullable: true })
  fiat: number;

  @Column({ type: 'float', nullable: true })
  fiatInCHF: number;

  @Column({ type: 'int', nullable: true })
  asset: any;

  @Column({ type: 'datetime2', nullable: true })
  received: Date;

  @Column({ type: 'varchar', default: PaymentStatus.UNPROCESSED, length: 256 })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 256, nullable: true })
  info: string;

  @Column({ type: 'varchar', default: PaymentError.NULL, length: 256 })
  errorCode: PaymentError;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
