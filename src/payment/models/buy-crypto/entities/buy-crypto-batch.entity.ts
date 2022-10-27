import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { AbortBatchCreationException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoFee } from './buy-crypto-fees.entity';
import { BuyCrypto } from './buy-crypto.entity';

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
      !this.isWholeBatchAmountPurchasable(maxPurchasableAmount) &&
      this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount)
    ) {
      this.reBatchToMaxReferenceAmount(maxPurchasableAmount);

      /**
       * purchase is required, though liquidity is not enough to purchase for entire batch -> re-batching to smaller amount *
       * warning is returned because on high load of small transactions, big transaction might be sliced out over and over again, without any notice
       */
      return [true, true];
    }

    if (!this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount)) {
      throw new AbortBatchCreationException(
        `
          Not enough liquidity to create batch for asset ${this.outputAsset}.
          Required reference amount: ${this.outputReferenceAmount} ${this.outputReferenceAsset}.
          Available amount: ${availableAmount} ${this.outputReferenceAsset}.
          Maximum purchasable amount: ${maxPurchasableAmount} ${this.outputReferenceAsset}.
        `,
      );
    }

    return [true, false];
  }

  checkAndRecordFeesEstimations(purchaseFeeAmount: number, payoutFeeAmount: number): this {
    this.checkFees(purchaseFeeAmount, payoutFeeAmount);
    this.recordFees(purchaseFeeAmount, payoutFeeAmount);

    return this;
  }

  secure(liquidity: number, purchaseFee = 0): this {
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
    return amount >= this.outputReferenceAmount * 1.05;
  }

  private isEnoughToSecureAtLeastOneTransaction(amount: number): boolean {
    return amount >= this.smallestTransactionReferenceAmount * 1.05;
  }

  private isWholeBatchAmountPurchasable(maxPurchasableAmount: number): boolean {
    return maxPurchasableAmount >= this.outputReferenceAmount * 1.05;
  }

  private reBatchToMaxReferenceAmount(liquidityLimit: number): this {
    if (this.id || this.created) throw new Error(`Cannot re-batch previously saved batch. Batch ID: ${this.id}`);

    const currentTransactions = this.sortTransactionsAsc();
    const reBatchTransactions = [];
    let requiredLiquidity = 0;

    for (const tx of currentTransactions) {
      requiredLiquidity += tx.outputReferenceAmount;

      if (requiredLiquidity < liquidityLimit) {
        reBatchTransactions.push(tx);
        continue;
      }

      break;
    }

    if (reBatchTransactions.length === 0) {
      const { dexName, type, blockchain } = this.outputAsset;

      throw new Error(
        `Cannot re-batch transactions in batch, liquidity limit is too low. Out asset: ${dexName} ${type} ${blockchain}`,
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

  private checkFees(purchaseFeeAmount: number, payoutFeeAmount: number): void {
    const feeRatio = Util.round((purchaseFeeAmount + payoutFeeAmount) / this.outputReferenceAmount, 8);

    if (feeRatio > 0.001) {
      throw new Error(
        `BuyCryptoBatch fee limit exceeded. Output Asset: ${this.outputAsset.dexName}. Fee ratio: ${Util.round(
          feeRatio * 100,
          5,
        )}%`,
      );
    }
  }

  private recordFees(purchaseFeeAmount: number, payoutFeeAmount: number): void {
    this.transactions.forEach((tx) => {
      const fee = BuyCryptoFee.create(
        this.calculateFeeShare(tx, purchaseFeeAmount),
        this.calculateFeeShare(tx, payoutFeeAmount),
        tx,
      );

      tx.fee = fee;
    });
  }

  private addActualPurchaseFee(purchaseFeeAmount: number, tx: BuyCrypto): void {
    const txPurchaseFee = this.calculateFeeShare(tx, purchaseFeeAmount);
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
