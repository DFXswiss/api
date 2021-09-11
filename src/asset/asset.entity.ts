import { Buy } from 'src/buy/buy.entity';
import { Log } from 'src/log/log.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  UpdateDateColumn,
} from 'typeorm';

export enum AssetType {
  COIN = 'Coin',
  DCT = 'DCT',
  DAT = 'DAT',
}

@Entity()
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false, unique: true})
  chainId: number;

  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ length: 256 })
  type: AssetType;

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
