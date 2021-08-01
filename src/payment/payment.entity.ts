import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  PrimaryColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import * as typeorm from 'typeorm';

export enum PaymentType {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum PaymentError {
  NULL = "",
  IBAN = 'Iban',
  BANKUSAGE = 'Bankusage',
  FIAT = 'Fiat',
  ASSET = 'Asset',
  KYC = 'Kyc',
}

export enum PaymentStatus {
  UNPROCESSED = 'Unprocessed',
  PROCESSED = 'Processed',
}

@Entity()
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true, default: null })
  userId: number;

  @Column({ type: 'varchar' })
  type: PaymentType;

  @Column({ type: 'varchar', length: 34, nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  iban: string;

  @Column({ type: 'varchar', length: 34, nullable: true })
  depositAddress: string;

  @Column({ type: 'int', nullable: true })
  fiat: number;

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'int', nullable: true })
  asset: number;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @Column({ type: 'varchar', default: PaymentStatus.UNPROCESSED })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 258, nullable: true })
  info: string;

  @Column({ type: 'varchar', default: PaymentError.NULL})
  errorCode: PaymentError;

  @CreateDateColumn({ name: 'created' })
  created: Date;
}
