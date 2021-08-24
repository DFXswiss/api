import { Buy } from 'src/buy/buy.entity';
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

  @Column({ type: 'varchar', unique: true, length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 256 })
  type: AssetType;

  @Column({ default: 1 })
  buyable: boolean;

  @Column({ default: 1 })
  sellable: boolean;

  @OneToMany(() => Buy, (buy) => buy.asset)
  buys: Buy[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
