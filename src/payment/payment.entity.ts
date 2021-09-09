import { Asset } from 'src/asset/asset.entity';
import { Fiat } from 'src/fiat/fiat.entity';
import { Log } from 'src/log/log.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';

export enum PaymentType {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum PaymentError {
  NA = 'NA',
  IBAN = 'IBAN',
  BANKUSAGE = 'Bankusage',
  FIAT = 'Fiat',
  ASSET = 'Asset',
  KYC = 'KYC',
  ACCOUNTCHECK = 'Account-check',
  NAMECHECK = 'Name-check',
  USERDATA = 'UserData',
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

  @ManyToOne(() => Fiat, { eager: true })
  @JoinColumn()
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  btcValue: number;

  @Column({ type: 'float', nullable: true })
  fiatInCHF: number;

  @ManyToOne(() => Asset, { eager: true })
  @JoinColumn()
  asset: Asset;

  @Column({ type: 'datetime2', nullable: true })
  received: Date;

  @Column({ type: 'varchar', default: PaymentStatus.UNPROCESSED, length: 256 })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 256, nullable: true })
  info: string;

  @Column({ type: 'varchar', default: PaymentError.NA, length: 256 })
  errorCode: PaymentError;

  @Column({ default: false })
  accepted: boolean

  @OneToMany(() => Log, (log) => log.payment,{ lazy: true, cascade: ["insert"]})
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
  
}
