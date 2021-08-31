import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/user/user.entity';
import { Asset } from 'src/asset/asset.entity';
import { Fiat } from 'src/fiat/fiat.entity';
import { Payment } from 'src/payment/payment.entity';

export enum LogDirection {
  fiat2asset = 'fiat-to-asset',
  asset2fiat = 'asset-to-fiat',
}

export enum LogType {
  INFO = 'Info',
  TRANSACTION = 'Transaction',
  VOLUME = 'Volume',
}

export enum LogStatus {
  fiatDeposit = 'fiat-deposit',
  fiat2btc = 'fiat-to-btc',
  btc2dfi = 'btc-to-dfi',
  dfi2asset = 'dfi-to-asset',
  assetWithdrawal = 'asset-withdrawal',
  assetDeposit = 'asset-deposit',
  btc2fiat = 'btc-to-fiat',
  dfi2btc = 'dfi-to-btc',
  asset2dfi = 'asset-to-dfi',
  fiatWithdrawal = 'fiat-withdrawal',
}

@Entity()
export class Log {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, length: 256 })
  orderId: string;

  @Column({ type: 'varchar', nullable: true, length: 256 })
  address: string;

  @Column({ type: 'varchar', length: 256 })
  type: LogType;

  @Column({ type: 'varchar', nullable: true, length: 256 })
  status: LogStatus;

  @ManyToOne(() => Fiat, { eager: true })
  @JoinColumn()
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'float', nullable: true })
  fiatInCHF: number;

  @ManyToOne(() => Asset, { eager: true })
  @JoinColumn()
  asset: Asset;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  // @Column({ type: 'varchar', length: 32, nullable: true })
  // iban: string;

  @Column({ type: 'varchar', nullable: true, length: 256 })
  direction: LogDirection;

  @Column({ type: 'varchar', nullable: true, length: 256 })
  message: string;

  @Column({ type: 'varchar', nullable: true, length: 256 })
  blockchainTx: string;

  @ManyToOne(() => User, { eager: false, lazy: true })
  @JoinColumn()
  user: User;

  @ManyToOne(() => Payment, { lazy: true, cascade: ["insert"] })
  @JoinColumn()
  payment: Payment;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
  
}
