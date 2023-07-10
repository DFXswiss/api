import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Column, Entity, Index } from 'typeorm';
import { IEntity } from '../entity';

export enum AssetType {
  COIN = 'Coin',
  TOKEN = 'Token',
  CUSTOM = 'Custom',
}

export enum AssetCategory {
  POOL_PAIR = 'PoolPair',
  STOCK = 'Stock',
  CRYPTO = 'Crypto',
}

export enum FeeTier {
  TIER0 = 'Tier0',
  TIER1 = 'Tier1',
  TIER2 = 'Tier2',
  TIER3 = 'Tier3',
  TIER4 = 'Tier4',
}

@Entity()
@Index((asset: Asset) => [asset.dexName, asset.type, asset.blockchain], { unique: true })
export class Asset extends IEntity {
  @Column({ nullable: true })
  chainId: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  uniqueName: string;

  @Column({ length: 256, nullable: true })
  description: string;

  @Column({ length: 256 })
  type: AssetType;

  @Column({ length: 256, nullable: false, default: AssetCategory.STOCK })
  category: AssetCategory;

  @Column({ nullable: true, length: 256 })
  sellCommand: string;

  @Column({ nullable: true, length: 256 })
  dexName: string;

  @Column({ default: true })
  buyable: boolean;

  @Column({ default: true })
  sellable: boolean;

  @Column({ length: 256, default: Blockchain.DEFICHAIN })
  blockchain: Blockchain;

  @Column({ length: 256, nullable: false, default: FeeTier.TIER2 })
  feeTier: FeeTier;

  @Column({ default: false })
  comingSoon: boolean;

  @Column({ nullable: true })
  sortOrder: number;

  @Column({ type: 'float', nullable: true })
  approxPriceUsd: number;

  get minimalPriceReferenceAmount() {
    return this.approxPriceUsd ? 1 / this.approxPriceUsd : 1;
  }
}
