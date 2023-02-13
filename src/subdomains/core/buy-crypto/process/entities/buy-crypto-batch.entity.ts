import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { AbortBatchCreationException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoFee } from './buy-crypto-fees.entity';
import { BuyCrypto } from './buy-crypto.entity';
import { FeeLimitExceededException } from '../exceptions/fee-limit-exceeded.exception';

export enum BuyCryptoBatchStatus {
  CREATED = 'Created',
  SECURED = 'Secured',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
}

type IsPurchaseRequired = boolean;
type LiquidityWarning = boolean;

@Entity()
export class BuyCryptoBatch extends IEntity {
  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.batch, { cascade: true })
  transactions: BuyCrypto[];

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset: Asset;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  status: BuyCryptoBatchStatus;

  @Column({ length: 256, nullable: true })
  blockchain: Blockchain;

  addTransaction(tx: BuyCrypto): this {
    tx.batch = this;

    this.transactions = [...(this.transactions ?? []), tx];

    this.outputReferenceAmount = Util.round((this.outputReferenceAmount ?? 0) + tx.outputReferenceAmount, 8);

    return this;
  }

  // amounts to be provided in reference asset
  optimizeByLiquidity(availableAmount: number, maxPurchasableAmount: number): [IsPurchaseRequired, LiquidityWarning] {
    if (this.isEnoughToSecureBatch(availableAmount)) {
      // no changes to batch required, no purchase required
      return [false, false];
    }

    if (this.isEnoughToSecureAtLeastOneTransaction(availableAmount)) {
      this.reBatchToMaxReferenceAmount(availableAmount);

      // no purchase required yet, proceeding with transactions for all available liquidity
      return [false, false];
    }

    if (
      !this.isWholeBatchAmountPurchasable(maxPurchasableAmount, 0.05) &&
      this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount, 0.05)
    ) {
      this.reBatchToMaxReferenceAmount(maxPurchasableAmount, 0.05);

      /**
       * purchase is required, though liquidity is not enough to purchase for entire batch -> re-batching to smaller amount *
       * warning is returned because on high load of small transactions, big transaction might be sliced out over and over again, without any notice
       */
      return [true, true];
    }

    if (!this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount)) {
      throw new AbortBatchCreationException(
        `Not enough liquidity to create a ${this.outputAsset.uniqueName} buy-crypto batch.`,
      );
    }

    return [true, false];
  }

  checkAndRecordFeesEstimations(
    estimatePurchaseFeeAmount: number | null,
    estimatePayoutFeeAmount: number | null,
  ): this {
    this.checkFees(estimatePurchaseFeeAmount, estimatePayoutFeeAmount);
    this.recordFees(estimatePurchaseFeeAmount, estimatePayoutFeeAmount);

    return this;
  }

  secure(liquidity: number, purchaseFee: number | null): this {
    this.outputAmount = liquidity;
    this.status = BuyCryptoBatchStatus.SECURED;

    const updatedTransactions = this.transactions.map((t) => {
      this.addActualPurchaseFee(purchaseFee, t);

      return t.calculateOutputAmount(this.outputReferenceAmount, this.outputAmount);
    });

    this.fixRoundingMismatch();

    this.transactions = updatedTransactions;

    return this;
  }

  complete(): this {
    this.status = BuyCryptoBatchStatus.COMPLETE;

    return this;
  }

  pending(): this {
    this.status = BuyCryptoBatchStatus.PENDING_LIQUIDITY;

    return this;
  }

  payingOut(): this {
    this.status = BuyCryptoBatchStatus.PAYING_OUT;

    return this;
  }

  //*** GETTERS ***//

  get minimalOutputReferenceAmount(): number {
    return this.outputReferenceAsset.dexName === 'BTC' ? 0.001 : 1;
  }

  get smallestTransactionReferenceAmount(): number {
    return Util.minObj<BuyCrypto>(this.transactions, 'outputReferenceAmount');
  }

  //*** HELPER METHODS ***//

  private isEnoughToSecureBatch(amount: number): boolean {
    return amount >= this.outputReferenceAmount;
  }

  private isEnoughToSecureAtLeastOneTransaction(amount: number, bufferCap = 0): boolean {
    // configurable reserve cap, because purchasable amounts are indicative and may be different on actual purchase
    return amount >= this.smallestTransactionReferenceAmount * (1 + bufferCap);
  }

  private isWholeBatchAmountPurchasable(maxPurchasableAmount: number, bufferCap = 0): boolean {
    // configurable reserve cap, because purchasable amounts are indicative and may be different on actual purchase
    return maxPurchasableAmount >= this.outputReferenceAmount * (1 + bufferCap);
  }

  private reBatchToMaxReferenceAmount(liquidityLimit: number, bufferCap = 0): this {
    if (this.id || this.created) throw new Error(`Cannot re-batch previously saved batch. Batch ID: ${this.id}`);

    const currentTransactions = this.sortTransactionsAsc();
    const reBatchTransactions = [];
    let requiredLiquidity = 0;

    for (const tx of currentTransactions) {
      requiredLiquidity += tx.outputReferenceAmount;

      // configurable reserve cap, because purchasable amounts are indicative and may be different on actual purchase
      if (requiredLiquidity <= liquidityLimit * (1 - bufferCap)) {
        reBatchTransactions.push(tx);
        continue;
      }

      break;
    }

    if (reBatchTransactions.length === 0) {
      throw new Error(
        `Cannot re-batch transactions in batch, liquidity limit is too low. Out asset: ${this.outputAsset.uniqueName}`,
      );
    }

    this.overwriteTransactions(reBatchTransactions);

    return this;
  }

  private overwriteTransactions(overwriteTransaction: BuyCrypto[]): void {
    if (this.id || this.created) {
      throw new Error(`Cannot overwrite transactions of previously saved batch. Batch ID: ${this.id}`);
    }

    this.resetBatch();
    overwriteTransaction.forEach((tx) => this.addTransaction(tx));
  }

  private resetBatch(): void {
    if (this.id || this.created) {
      throw new Error(`Cannot reset previously saved batch. Batch ID: ${this.id}`);
    }

    this.transactions = [];
    this.outputReferenceAmount = 0;
  }

  private checkFees(purchaseFeeAmount: number | null, payoutFeeAmount: number | null): void {
    const feeRatio = Util.round((purchaseFeeAmount + payoutFeeAmount) / this.outputReferenceAmount, 8);
    const { configuredFeeLimit, defaultFeeLimit } = Config.buy.fee.limits;

    if (feeRatio > (configuredFeeLimit ?? defaultFeeLimit)) {
      throw new FeeLimitExceededException(
        `BuyCryptoBatch fee limit exceeded. Output Asset: ${this.outputAsset.dexName}. Fee ratio: ${Util.round(
          feeRatio * 100,
          5,
        )}%`,
      );
    }
  }

  private recordFees(estimatePurchaseFeeAmount: number | null, estimatePayoutFeeAmount: number | null): void {
    this.transactions.forEach((tx) => {
      const fee = BuyCryptoFee.create(
        estimatePurchaseFeeAmount != null ? this.calculateFeeShare(tx, estimatePurchaseFeeAmount) : null,
        estimatePayoutFeeAmount != null ? this.calculateFeeShare(tx, estimatePayoutFeeAmount) : null,
        tx,
      );

      tx.recordFee(fee);
    });
  }

  private addActualPurchaseFee(purchaseFeeAmount: number | null, tx: BuyCrypto): void {
    const txPurchaseFee = purchaseFeeAmount != null ? this.calculateFeeShare(tx, purchaseFeeAmount) : null;
    tx.fee.addActualPurchaseFee(txPurchaseFee, tx);
  }

  private calculateFeeShare(tx: BuyCrypto, totalFee: number): number {
    return Util.round((totalFee / this.outputReferenceAmount) * tx.outputReferenceAmount, 8);
  }

  private fixRoundingMismatch(): void {
    const transactionsTotal = Util.sumObj<BuyCrypto>(this.transactions, 'outputAmount');

    const mismatch = Util.round(this.outputAmount - transactionsTotal, 8);

    if (mismatch === 0) {
      return;
    }

    if (Math.abs(mismatch) < 0.00001) {
      let remainsToDistribute = mismatch;
      const correction = remainsToDistribute > 0 ? 0.00000001 : -0.00000001;
      const adjustedTransactions = [];

      this.transactions.forEach((tx) => {
        if (remainsToDistribute !== 0) {
          tx.outputAmount = Util.round(tx.outputAmount + correction, 8);
          adjustedTransactions.push(tx);
          remainsToDistribute = Util.round(remainsToDistribute - correction, 8);
        }
      });

      console.info(
        `Fixed total output amount mismatch of ${mismatch} ${
          this.outputAsset.dexName
        }. Added to transaction ID(s): ${adjustedTransactions.map((tx) => tx.id)}`,
      );
    } else {
      throw new Error(`Output amount mismatch is too high. Mismatch: ${mismatch} ${this.outputAsset.dexName}`);
    }
  }

  private sortTransactionsAsc(): BuyCrypto[] {
    return this.transactions.sort((a, b) => a.outputReferenceAmount - b.outputReferenceAmount);
  }
}
