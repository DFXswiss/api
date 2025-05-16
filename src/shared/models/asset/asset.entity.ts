import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AmlRule } from 'src/subdomains/core/aml/enums/aml-rule.enum';
import { LiquidityManagementRule } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-rule.entity';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { PriceRule } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { Column, Entity, Index, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { IEntity } from '../entity';

export enum AssetType {
  COIN = 'Coin',
  TOKEN = 'Token',
  CUSTOM = 'Custom',
  CUSTODY = 'Custody',
  POOL = 'Pool',
  PRESALE = 'Presale',
}

export enum AssetCategory {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

@Entity()
@Index((asset: Asset) => [asset.dexName, asset.type, asset.blockchain], { unique: true })
export class Asset extends IEntity {
  @Column({ nullable: true })
  chainId?: string;

  @Column({ type: 'int', nullable: true })
  decimals?: number;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 256 })
  uniqueName: string;

  @Column({ length: 256, nullable: true })
  description?: string;

  @Column({ length: 256 })
  type: AssetType;

  @Column({ length: 256, default: AssetCategory.PUBLIC })
  category: AssetCategory;

  @Column({ nullable: true, length: 256 })
  sellCommand?: string;

  @Column({ nullable: true, length: 256 })
  dexName?: string;

  @Column({ default: true })
  buyable: boolean;

  @Column({ default: true })
  sellable: boolean;

  @Column({ default: true })
  cardBuyable: boolean;

  @Column({ default: true })
  cardSellable: boolean;

  @Column({ default: true })
  instantBuyable: boolean;

  @Column({ default: true })
  instantSellable: boolean;

  @Column({ default: false })
  paymentEnabled: boolean;

  @Column({ default: false })
  ikna: boolean;

  @Column({ length: 256, default: Blockchain.DEFICHAIN })
  blockchain: Blockchain;

  @Column({ default: false })
  comingSoon: boolean;

  @Column({ nullable: true })
  sortOrder?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceUsd?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceChf?: number;

  @Column({ type: 'float', nullable: true })
  approxPriceEur?: number;

  @Column({ length: 256, nullable: true })
  financialType?: string;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleFrom: AmlRule;

  @Column({ default: AmlRule.DEFAULT })
  amlRuleTo: AmlRule;

  @OneToOne(() => LiquidityManagementRule, (lmr) => lmr.targetAsset)
  liquidityManagementRule: LiquidityManagementRule;

  @OneToMany(() => AssetPrice, (assetPrice) => assetPrice.asset)
  prices: AssetPrice[];

  @ManyToOne(() => PriceRule)
  priceRule: PriceRule;

  get minimalPriceReferenceAmount() {
    return this.approxPriceChf ? 1 / this.approxPriceChf : 1;
  }

  isBuyableOn(blockchains: Blockchain[]): boolean {
    return blockchains.includes(this.blockchain) || this.type === AssetType.CUSTOM;
  }

  get isActive(): boolean {
    return (
      this.buyable ||
      this.cardBuyable ||
      this.instantBuyable ||
      this.sellable ||
      this.cardSellable ||
      this.instantSellable ||
      this.paymentEnabled
    );
  }
}
