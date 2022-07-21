import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity } from 'typeorm';

export enum LiquidityOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
}

export type ChainSwapId = string;
export type TargetAmount = number;

@Entity()
export class LiquidityOrder extends IEntity {
  // not needed in target event based solution, now correlationId is not unique
  @Column({ length: 256, nullable: false })
  context: LiquidityOrderContext;

  @Column({ length: 256, nullable: false })
  correlationId: string;

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

  @Column({ nullable: false })
  targetAsset: Asset;

  @Column({ type: 'float', nullable: false })
  targetAmount: number;

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

  get isReferenceAsset(): boolean {
    return (
      this.targetAsset.dexName === 'BTC' || this.targetAsset.dexName === 'USDC' || this.targetAsset.dexName === 'USDT'
    );
  }

  get maxPriceSlippage(): number {
    return this.isReferenceAsset ? 0.005 : 0.03;
  }
}
