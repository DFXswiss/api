import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { PurchaseLiquidityResult } from '../interfaces';

export enum LiquidityOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  STAKING_REWARD = 'StakingReward',
  CREATE_POOL_PAIR = 'CreatePoolPair',
  PRICING = 'Pricing',
  LIQUIDITY_MANAGEMENT = 'LiquidityManagement',
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

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  referenceAsset: Asset;

  @Column({ type: 'float', nullable: false })
  referenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  targetAsset: Asset;

  @Column({ type: 'float', nullable: true })
  targetAmount: number;

  @Column({ nullable: false, default: false })
  isReady: boolean;

  @Column({ nullable: false, default: false })
  isComplete: boolean;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  swapAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  swapAmount?: number;

  @Column({ length: 256, nullable: true })
  purchaseStrategy?: string;

  @Column({ length: 256, nullable: true })
  purchaseTxId?: string;

  @Column({ type: 'float', nullable: true })
  purchasedAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  purchaseFeeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  purchaseFeeAmount?: number;

  reserved(targetAmount: number): this {
    this.setTargetAmount(targetAmount);
    this.isReady = true;

    return this;
  }

  addPurchaseMetadata(purchaseTxId: string, swapAsset?: Asset, swapAmount?: number): this {
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

  recordPurchaseFee(purchaseFeeAsset: Asset, purchaseFeeAmount: number): this {
    this.purchaseFeeAsset = purchaseFeeAsset;
    this.purchaseFeeAmount = purchaseFeeAmount;

    return this;
  }

  getPurchaseLiquidityResult(): PurchaseLiquidityResult {
    return {
      target: { asset: this.targetAsset, amount: this.targetAmount },
      purchaseFee: { asset: this.purchaseFeeAsset, amount: this.purchaseFeeAmount },
    };
  }

  complete(): this {
    this.isComplete = true;

    return this;
  }

  private setTargetAmount(incomingAmount: number): void {
    this.targetAmount =
      this.referenceAsset.dexName === this.targetAsset.dexName ? this.referenceAmount : incomingAmount;
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
