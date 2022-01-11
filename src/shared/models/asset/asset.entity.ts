import { Buy } from 'src/user/models/buy/buy.entity';
import { Log } from 'src/user/models/log/log.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';

export enum AssetType {
  COIN = 'Coin',
  DCT = 'DCT',
  DAT = 'DAT',
}

@Entity()
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  chainId: number;

  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ type: 'float', nullable: false, default: 0 })
  minDepositAmount: number;

  @Column({ length: 256 })
  type: AssetType;

  @Column({ default: false })
  isLP: boolean;

  @Column({ nullable: true, length: 256 })
  sellCommand: string;

  @Column({ nullable: true, length: 256 })
  dexName: string;

  @Column({ default: true })
  buyable: boolean;

  @Column({ default: true })
  sellable: boolean;

  @OneToMany(() => Buy, (buy) => buy.asset)
  buys: Buy[];

  @OneToMany(() => Log, (log) => log.asset)
  logs: Log[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
