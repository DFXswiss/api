import { Entity, Column } from 'typeorm';
import { IEntity } from '../entity';

export enum AssetType {
  COIN = 'Coin',
  DCT = 'DCT',
  DAT = 'DAT',
}

export enum AssetCategory {
  D_TOKEN = 'DToken',
  COIN = 'Coin',
  POOL_PAIR = 'PoolPair',
}

@Entity()
export class Asset extends IEntity {
  @Column({ type: 'int', nullable: true })
  chainId: number;

  @Column({ unique: true, length: 256 })
  name: string;

  @Column({ length: 256 })
  type: AssetType;

  @Column({ length: 256, nullable: false, default: 'default' })
  category: AssetCategory;

  @Column({ nullable: true, length: 256 })
  sellCommand: string;

  @Column({ nullable: true, length: 256 })
  dexName: string;

  @Column({ default: true })
  buyable: boolean;

  @Column({ default: true })
  sellable: boolean;
}
