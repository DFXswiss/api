import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum LiquidityOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  CREATE_POOL_PAIR = 'CreatePoolPair',
}

export type ChainSwapId = string;
export type TargetAmount = number;

@Entity()
export class LiquidityOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  context: LiquidityOrderContext;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: false })
  strategy: string;

  @Column({ length: 256, nullable: false })
  chain: string;

  @Column({ length: 256, nullable: false })
  chainSwapId: string;

  @Column({ length: 256, nullable: true })
  referenceAsset?: string;

  @Column({ type: 'float', nullable: true })
  referenceAmount?: number;

  @Column({ length: 256, nullable: true })
  sourceAsset: string;

  @Column({ type: 'float', nullable: true })
  sourceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  targetAsset: Asset;

  @Column({ type: 'float', nullable: false })
  targetAmount: number;

  @Column({ nullable: false, default: false })
  isReady: boolean;

  @Column({ nullable: false, default: false })
  isComplete: boolean;

  addChainSwapId(chainSwapId: string): this {
    this.chainSwapId = chainSwapId;

    return this;
  }

  recordLiquiditySourceAsset(sourceAsset: string, sourceAmount: number): this {
    this.sourceAsset = sourceAsset;
    this.sourceAmount = sourceAmount;

    return this;
  }

  ready(targetAmount: number): this {
    this.targetAmount = targetAmount;
    this.isReady = true;

    return this;
  }

  complete(): this {
    this.isComplete = true;

    return this;
  }

  static getIsReferenceAsset(asset: string): boolean {
    return asset === 'BTC' || asset === 'USDC' || asset === 'USDT';
  }

  static getMaxPriceSlippage(asset: string): number {
    return this.getIsReferenceAsset(asset) ? 0.005 : 0.03;
  }

  get isReferenceAsset(): boolean {
    return LiquidityOrder.getIsReferenceAsset(this.targetAsset.dexName);
  }

  get maxPriceSlippage(): number {
    return LiquidityOrder.getMaxPriceSlippage(this.targetAsset.dexName);
  }
}
