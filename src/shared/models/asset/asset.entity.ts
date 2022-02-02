import { Buy } from 'src/payment/models/buy/buy.entity';
import { Log } from 'src/user/models/log/log.entity';
import { Entity, Column, OneToMany } from 'typeorm';
import { IEntity } from '../entity';

export enum AssetType {
  COIN = 'Coin',
  DCT = 'DCT',
  DAT = 'DAT',
}

@Entity()
export class Asset extends IEntity {
  @Column({ type: 'int', nullable: true })
  chainId: number;

  @Column({ unique: true, length: 256 })
  name: string;

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
}
