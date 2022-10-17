import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';

export enum LiquidityOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  STAKING_REWARD = 'StakingReward',
  CREATE_POOL_PAIR = 'CreatePoolPair',
  PRICING = 'Pricing',
}

export enum LiquidityOrderType {
  PURCHASE = 'Purchase',
  RESERVATION = 'Reservation',
}

export type ChainSwapId = string;
export type TargetAmount = number;

@Entity()
export class LiquidityOrder extends IEntity {
  @Column({ length: 256, nullable: false })
  type: LiquidityOrderType;

  @Column({ length: 256, nullable: false })
  context: LiquidityOrderContext;

  @Column({ length: 256, nullable: false })
  correlationId: string;

  @Column({ length: 256, nullable: false })
  chain: Blockchain;

  @Column({ length: 256, nullable: false })
  referenceAsset: string;

  @Column({ type: 'float', nullable: false })
  referenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: false })
  targetAsset: Asset;

  @Column({ type: 'float', nullable: true })
  targetAmount: number;

  @Column({ nullable: false, default: false })
  isReady: boolean;

  @Column({ nullable: false, default: false })
  isComplete: boolean;

  @Column({ length: 256, nullable: true })
  swapAsset?: string;

  @Column({ type: 'float', nullable: true })
  swapAmount?: number;

  @Column({ length: 256, nullable: true })
  purchaseStrategy?: string;

  @Column({ length: 256, nullable: true })
  purchaseTxId?: string;

  @Column({ type: 'float', nullable: true })
  purchasedAmount?: number;

  reserved(targetAmount: number): this {
    this.setTargetAmount(targetAmount);
    this.isReady = true;

    return this;
  }

  addPurchaseMetadata(purchaseTxId: string, swapAsset?: string, swapAmount?: number): this {
    this.purchaseTxId = purchaseTxId;
    this.swapAsset = swapAsset;
    this.swapAmount = swapAmount;

    return this;
  }

  purchased(purchasedAmount: number): this {
    this.purchasedAmount = purchasedAmount;
    this.setTargetAmount(purchasedAmount);
    this.isReady = true;

    return this;
  }

  complete(): this {
    this.isComplete = true;

    return this;
  }

  private setTargetAmount(incomingAmount: number): void {
    this.targetAmount = this.referenceAsset === this.targetAsset.dexName ? this.referenceAmount : incomingAmount;
  }

  static getIsReferenceAsset(asset: string): boolean {
    return ['BTC', 'USDC', 'USDT', 'ETH', 'BNB'].includes(asset);
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
