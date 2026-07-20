import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { baseUnitsTransformer } from 'src/shared/models/base-units.transformer';
import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { LiquidityTransactionResult } from '../interfaces';

export enum LiquidityOrderContext {
  BUY_CRYPTO = 'BuyCrypto',
  LIQUIDITY_MANAGEMENT = 'LiquidityManagement',
  BUY_FIAT_RETURN = 'BuyFiatReturn',
  BUY_CRYPTO_RETURN = 'BuyCryptoReturn',
  MANUAL = 'Manual',
  REF_PAYOUT = 'RefPayout',
  TRADING = 'Trading',
}

export enum LiquidityOrderType {
  PURCHASE = 'Purchase',
  RESERVATION = 'Reservation',
  SELL = 'Sell',
}

export type ChainSwapId = string;
export type TargetAmount = number;

@Entity()
// IDX_liquidity_order_inflight_purchase is deliberately migration-owned for stable schema management.
// Do not re-declare it here or let schema generation remove the partial unique index.
@Index((order: LiquidityOrder) => [order.context, order.correlationId])
export class LiquidityOrder extends IEntity {
  @Column({ length: 256 })
  type: LiquidityOrderType;

  @Column({ length: 256 })
  context: LiquidityOrderContext;

  @Column({ length: 256 })
  correlationId: string;

  @Column({ length: 256 })
  chain: Blockchain;

  @Index()
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  referenceAsset?: Asset;

  @Column({ type: 'float' })
  referenceAmount: number;

  @Index()
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  targetAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  targetAmount?: number;

  // §2.3 native-first exactness (issue #4287 stage 2): the EXACT integer base units (wei) of the DfxDex swap
  // OUTPUT (`targetAmount`, the raw on-chain transfer integer). Nullable + additive — legacy rows, non-EVM
  // chains and the reference==target degenerate case stay null and the ledger derives from the <=8-dp float
  // (fail-open). numeric <-> JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  targetAmountBaseUnits?: bigint | null;

  @Column({ type: 'float', nullable: true })
  estimatedTargetAmount?: number;

  @Column({ default: false })
  isReady: boolean;

  @Column({ default: false })
  isComplete: boolean;

  @Index()
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  swapAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  swapAmount?: number;

  // §2.3 native-first exactness (issue #4287 stage 2): the EXACT integer base units (wei) of the DfxDex swap
  // INPUT (`swapAmount`, DFX float scaled at broadcast). Nullable + additive — null falls back to the <=8-dp
  // float derivation (fail-open). numeric <-> JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  swapAmountBaseUnits?: bigint | null;

  @Column({ length: 256, nullable: true })
  strategy?: string;

  @Column({ length: 256, nullable: true })
  txId?: string;

  @Column({ type: 'float', nullable: true })
  purchasedAmount?: number;

  @Index()
  @ManyToOne(() => Asset, { eager: true, nullable: true })
  feeAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  feeAmount?: number;

  // §2.3 native-first exactness (issue #4287 stage 3): the EXACT integer wei of the DfxDex swap's on-chain gas fee
  // (`feeAmount`), captured from the tx receipt; booked verbatim on the network-fee leg. Nullable + additive — null
  // falls back to the <=8-dp float derivation (fail-open). numeric <-> JS bigint via baseUnitsTransformer.
  @Column({ type: 'numeric', nullable: true, transformer: baseUnitsTransformer })
  feeAmountBaseUnits?: bigint | null;

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

  addEstimatedTargetAmount(amount: number): this {
    this.estimatedTargetAmount = amount;

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

  cancel(): this {
    this.isReady = true;
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
