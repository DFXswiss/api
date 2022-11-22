import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { LiquidityTransactionResult } from '../interfaces';

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
  SELL = 'Sell',
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
  strategy?: string;

  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ type: 'float', nullable: true })
  purchasedAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  feeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  feeAmount?: number;

  reserved(targetAmount: number): this {
    this.setTargetAmount(targetAmount);
    this.isReady = true;

    return this;
  }

  addBlockchainTransactionMetadata(txId: string, swapAsset?: Asset, swapAmount?: number): this {
    this.txId = txId;
    this.swapAsset = swapAsset;
    this.swapAmount = swapAmount;

    return this;
  }

  sold(receivedAmount: number): this {
    this.targetAmount = receivedAmount;
    this.isReady = true;

    return this;
  }

  purchased(purchasedAmount: number): this {
    this.purchasedAmount = purchasedAmount;

    this.setTargetAmount(purchasedAmount);
    this.isReady = true;

    return this;
  }

  recordFee(feeAsset: Asset, feeAmount: number): this {
    this.feeAsset = feeAsset;
    this.feeAmount = feeAmount;

    return this;
  }

  getLiquidityTransactionResult(): LiquidityTransactionResult {
    return {
      type: this.type,
      target: { asset: this.targetAsset, amount: this.targetAmount },
      fee: { asset: this.feeAsset, amount: this.feeAmount },
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
