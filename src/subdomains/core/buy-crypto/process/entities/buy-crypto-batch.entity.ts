import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Util } from 'src/shared/utils/util';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { MissingBuyCryptoLiquidityException } from '../exceptions/abort-batch-creation.exception';
import { BuyCrypto } from './buy-crypto.entity';

export enum BuyCryptoBatchStatus {
  CREATED = 'Created',
  SECURED = 'Secured',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
}

type IsPurchaseRequired = boolean;

@Entity()
export class BuyCryptoBatch extends IEntity {
  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.batch, { cascade: true })
  transactions: BuyCrypto[];

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputReferenceAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount?: number;

  @ManyToOne(() => Asset, { eager: true, nullable: true })
  outputAsset?: Asset;

  @Column({ type: 'float', nullable: true })
  outputAmount?: number;

  @Column({ length: 256, nullable: true })
  status?: BuyCryptoBatchStatus;

  @Column({ length: 256, nullable: true })
  blockchain?: Blockchain;

  //*** FACTORY METHODS ***//

  addTransaction(tx: BuyCrypto): this {
    tx.assignCandidateBatch(this);

    this.transactions = [...(this.transactions ?? []), tx];

    this.outputReferenceAmount = Util.round((this.outputReferenceAmount ?? 0) + tx.outputReferenceAmount, 8);

    return this;
  }

  // amounts to be provided in reference asset
  optimizeByLiquidity(availableAmount: number, maxPurchasableAmount: number): IsPurchaseRequired {
    if (this.isEnoughToSecureBatch(availableAmount)) {
      // no changes to batch required, no purchase required
      return false;
    }

    if (this.isEnoughToSecureAtLeastOneTransaction(availableAmount)) {
      this.reBatchToMaxReferenceAmount(availableAmount);

      // no purchase required yet, proceeding with transactions for all available liquidity
      return false;
    }

    if (
      !this.isWholeBatchAmountPurchasable(maxPurchasableAmount, 0.05) &&
      this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount, 0.05)
    ) {
      this.reBatchToMaxReferenceAmount(maxPurchasableAmount, 0.05);

      // purchase is required, though liquidity is not enough to purchase for entire batch -> re-batching to smaller amount
      return true;
    }

    if (!this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount)) {
      throw new MissingBuyCryptoLiquidityException(
        `Not enough liquidity to create a ${this.outputAsset.uniqueName} buy-crypto batch.`,
      );
    }

    return true;
  }

  optimizeByPayoutFeeEstimation(): BuyCrypto[] {
    const filteredOutTransactions: BuyCrypto[] = [];

    for (const tx of this.transactions) {
      if (tx.fee.estimatePayoutFeeAmount > tx.fee.allowedTotalFeeAmount * Config.blockchainFeeBuffer) {
        filteredOutTransactions.push(tx);

        continue;
      }

      tx.resetSentMail();
    }

    this.removeInvalidTransactions(filteredOutTransactions);

    return filteredOutTransactions;
  }

  removeInvalidTransactions(invalidTransactions: BuyCrypto[]) {
    const validTransactions = this.transactions.filter((t) => !invalidTransactions.map((i) => i.id).includes(t.id));

    this.overwriteTransactions(validTransactions);
  }

  checkByPurchaseFeeEstimation(estimatePurchaseFeeAmount: number): this {
    this.recordPurchaseFees(estimatePurchaseFeeAmount);

    return this;
  }

  secure(liquidity: number, purchaseFee: number): UpdateResult<BuyCryptoBatch> {
    this.outputAmount = liquidity;
    this.status = BuyCryptoBatchStatus.SECURED;

    const updatedTransactions = this.transactions.map((t) => {
      this.addActualPurchaseFee(purchaseFee, t);

      return t.setOutputAmount(this.outputReferenceAmount, this.outputAmount);
    });

    this.fixRoundingMismatch();

    this.transactions = updatedTransactions;

    return [this.id, { outputAmount: this.outputAmount, status: this.status, transactions: this.transactions }];
  }

  complete(): UpdateResult<BuyCryptoBatch> {
    this.status = BuyCryptoBatchStatus.COMPLETE;

    return [this.id, { status: this.status }];
  }

  pending(): this {
    this.status = BuyCryptoBatchStatus.PENDING_LIQUIDITY;
    this.transactions.forEach((tx) => tx.pendingLiquidity());

    return this;
  }

  payingOut(): UpdateResult<BuyCryptoBatch> {
    this.status = BuyCryptoBatchStatus.PAYING_OUT;

    return [this.id, { status: this.status }];
  }

  //*** GETTERS ***//

  get minimalOutputReferenceAmount(): number {
    return this.outputReferenceAsset.dexName === 'BTC' ? 0.001 : 1;
  }

  get smallestTransactionReferenceAmount(): number {
    return this.smallestTransaction.outputReferenceAmount;
  }

  get smallestTransaction(): BuyCrypto {
    return Util.minObj(this.transactions, 'outputReferenceAmount');
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

  private recordPurchaseFees(estimatePurchaseFeeAmount: number): void {
    this.transactions.forEach((tx) => {
      tx.fee.addPurchaseFeeEstimation(this.calculateFeeShare(tx, estimatePurchaseFeeAmount), tx);

      tx.batched();
    });
  }

  private addActualPurchaseFee(purchaseFeeAmount: number, tx: BuyCrypto): void {
    const txPurchaseFee = this.calculateFeeShare(tx, purchaseFeeAmount);
    tx.addActualPurchaseFee(txPurchaseFee);
  }

  private calculateFeeShare(tx: BuyCrypto, totalFee: number): number {
    return Util.round((totalFee / this.outputReferenceAmount) * tx.outputReferenceAmount, 8);
  }

  private fixRoundingMismatch(): void {
    this.transactions = Util.fixRoundingMismatch(this.transactions, 'outputAmount', this.outputAmount, 8);
  }

  private sortTransactionsAsc(): BuyCrypto[] {
    return Util.sort(this.transactions, 'outputReferenceAmount');
  }
}
