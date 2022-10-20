import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { Column, Entity, OneToMany } from 'typeorm';
import { AbortBatchCreationException } from '../exceptions/abort-batch-creation.exception';
import { BuyCryptoFees } from './buy-crypto-fees.entity';
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

  @Column({ length: 256, nullable: true })
  outputReferenceAsset: string;

  @Column({ type: 'float', nullable: true })
  outputReferenceAmount: number;

  @Column({ length: 256, nullable: true })
  outputAsset: string;

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

  optimizeByLiquidity(availableAmount: number, maxPurchasableAmount: number): [this, IsPurchaseRequired] {
    if (this.isEnoughToSecureBatch(availableAmount)) {
      return [this, false];
    }

    if (this.isEnoughToSecureAtLeastOneTransaction(availableAmount)) {
      this.reBatchToMaxReferenceAmount(availableAmount);

      return [this, false];
    }

    if (
      !this.isWholeMissingAmountPurchasable(availableAmount, maxPurchasableAmount) &&
      this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount + availableAmount)
    ) {
      this.reBatchToMaxReferenceAmount(availableAmount + maxPurchasableAmount);

      return [this, true];
    }

    if (!this.isEnoughToSecureAtLeastOneTransaction(maxPurchasableAmount + availableAmount)) {
      throw new AbortBatchCreationException(
        `
          Not enough liquidity to create batch for asset ${this.outputAsset}.
          Required reference amount: ${this.outputReferenceAmount} ${this.outputReferenceAsset}.
          Available amount: ${availableAmount}  ${this.outputReferenceAsset}.
          Maximum purchasable amount: ${maxPurchasableAmount} ${this.outputReferenceAsset}.
        `,
      );
    }

    return [this, true];
  }

  optimizeByFees(purchaseFeeAmount: number, payoutFeeAmounts: { [key: number]: number }): this {
    const inputBatchLength = this.transactions.length;

    this.transactions = this.transactions.reduce((txs, tx, index) => {
      const fees = BuyCryptoFees.create(
        purchaseFeeAmount / this.transactions.length,
        payoutFeeAmounts[index],
        tx.outputReferenceAmount,
      );

      if (fees.isSatisfyConstraints()) {
        tx.fees = fees;
        txs.push(tx);
      }

      return txs;
    }, []);

    if (this.transactions.length === 0) {
      throw new Error(
        `Cannot re-batch transactions in batch, no transaction satisfy fee limit. Out asset: ${this.outputAsset}`,
      );
    }

    if (inputBatchLength === this.transactions.length) return this;

    this.optimizeByFees(purchaseFeeAmount, payoutFeeAmounts);
  }

  reBatchToMaxReferenceAmount(liquidity: number): this {
    if (this.id || this.created) throw new Error(`Cannot re-batch previously saved batch. Batch ID: ${this.id}`);

    const currentTransactions = this.transactions.sort((a, b) => a.outputReferenceAmount - b.outputReferenceAmount);
    const newTransactions = [];
    let totalAmount = 0;

    for (const tx of currentTransactions) {
      if (totalAmount + tx.outputReferenceAmount < liquidity) {
        newTransactions.push(tx);
        totalAmount += tx.outputReferenceAmount;
      }

      break;
    }

    if (newTransactions.length === 0) {
      throw new Error(
        `Cannot re-batch transactions in batch, liquidity limit is too low. Out asset: ${this.outputAsset}`,
      );
    }

    return this;
  }

  secure(liquidity: number): this {
    this.outputAmount = liquidity;
    this.status = BuyCryptoBatchStatus.SECURED;

    const updatedTransactions = this.transactions.map((t) =>
      t.calculateOutputAmount(this.outputReferenceAmount, this.outputAmount),
    );

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

  get minimalOutputReferenceAmount(): number {
    return this.outputReferenceAsset === 'BTC' ? 0.001 : 1;
  }

  get smallestTransactionReferenceAmount(): number {
    return 2;
  }

  //*** HELPER METHODS ***//

  private isEnoughToSecureBatch(amount: number): boolean {
    return amount >= this.outputReferenceAmount * 1.05;
  }

  private isEnoughToSecureAtLeastOneTransaction(amount: number): boolean {
    return amount >= this.smallestTransactionReferenceAmount * 1.05;
  }

  private isWholeMissingAmountPurchasable(availableAmount: number, maxPurchasableAmount: number): boolean {
    const missingAmount = this.outputReferenceAmount - availableAmount;

    return maxPurchasableAmount >= missingAmount * 1.05;
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
          this.outputAsset
        }. Added to transaction ID(s): ${adjustedTransactions.map((tx) => tx.id)}`,
      );
    } else {
      throw new Error(`Output amount mismatch is too high. Mismatch: ${mismatch} ${this.outputAsset}`);
    }
  }
}
