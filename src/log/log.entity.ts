import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import * as typeorm from 'typeorm';

export enum LogDirection {
  fiat2asset = 'fiat-to-asset',
  asset2fiat = 'asset-to-fiat',
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
  fiatWithdrawal = 'fiat-withdrawal'
}

@Entity()
export class Log {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true })
  orderId: string;

  @Column({ type: 'varchar' })
  address: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'varchar', nullable: true })
  status: LogStatus;

  @Column({ type: 'int', nullable: true })
  fiat: number;

  @Column({ type: 'float', nullable: true })
  fiatValue: number;

  @Column({ type: 'int', nullable: true })
  asset: number;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  iban: string;

  @Column({ type: 'varchar', nullable: true })
  direction: LogDirection;

  @Column({ type: 'varchar' })
  message: string;

  @CreateDateColumn({ name: 'created'}) 
  created: Date;
}