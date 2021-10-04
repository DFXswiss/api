import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, UpdateDateColumn } from 'typeorm';
import { User } from 'src/user/models/user/user.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Payment } from 'src/payment/models/payment/payment.entity';

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

  @Column({ unique: true, length: 256 })
  orderId: string;

  @Column({ nullable: true, length: 256 })
  address: string;

  @Column({ length: 256 })
  type: LogType;

  @Column({ nullable: true, length: 256 })
  status: LogStatus;

  @ManyToOne(() => Fiat, { eager: true })
  fiat: Fiat;

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'float', nullable: true })
  fiatInCHF: number;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @Column({ nullable: true, length: 256 })
  direction: LogDirection;

  @Column({ nullable: true, length: 256 })
  message: string;

  @Column({ nullable: true, length: 256 })
  blockchainTx: string;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => Payment)
  payment: Payment;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
