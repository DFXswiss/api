import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { Column, Entity, OneToMany } from 'typeorm';
import { BuyCrypto } from './buy-crypto.entity';

export enum BuyCryptoBatchStatus {
  CREATED = 'created',
  SECURED = 'secured',
  PENDING_LIQUIDITY = 'pending-liquidity',
  PAYING_OUT = 'paying-out',
  COMPLETE = 'complete',
}

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
  status: string;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  purchaseTxId: string;

  addTransaction(tx: BuyCrypto): this {
    if (!this.transactions) {
      this.transactions = [];
    }

    tx.batch = this;

    this.transactions = [...this.transactions, tx];

    if (!this.outputReferenceAmount) {
      this.outputReferenceAmount = 0;
    }

    this.outputReferenceAmount = Util.round(this.outputReferenceAmount + tx.outputReferenceAmount, 8);

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

  pending(purchaseTxId: string): this {
    this.purchaseTxId = purchaseTxId;
    this.status = BuyCryptoBatchStatus.PENDING_LIQUIDITY;

    return this;
  }

  payingOut(): this {
    this.status = BuyCryptoBatchStatus.PAYING_OUT;

    return this;
  }

  recordDexToOutTransfer(txId: string): this {
    this.outTxId = txId;

    return this;
  }

  groupPayoutTransactions(): BuyCrypto[][] {
    if (this.status !== BuyCryptoBatchStatus.SECURED) {
      throw new Error(`Cannot payout batch which is not secured. Batch ID: ${this.id}. Batch status: ${this.status}`);
    }

    console.info(`Grouping transactions for payout. Batch ID: ${this.id}`);

    const payoutTransactions = this.transactions.filter((tx) => !tx.txId);

    if (this.transactions.length > 0 && payoutTransactions.length !== this.transactions.length) {
      console.warn(
        `Skipped ${this.transactions.length - payoutTransactions.length} transactions of batch ID: ${
          this.id
        } to avoid double payout.`,
      );
    }

    const maxGroupSize = this.outputAsset === 'DFI' ? 100 : 10;
    const groups = this.createPayoutGroups(payoutTransactions, maxGroupSize);

    console.info(`Created ${groups.length} transaction group(s) for payout. Batch ID: ${this.id}`);

    return groups;
  }

  private createPayoutGroups(transactions: BuyCrypto[], maxGroupSize: number): BuyCrypto[][] {
    const result: Map<number, BuyCrypto[]> = new Map();

    let currentGroupNumber = 0;

    transactions.forEach((tx) => {
      let currentGroup = result.get(currentGroupNumber);

      if (!currentGroup) {
        currentGroup = [tx];
        result.set(currentGroupNumber, currentGroup);

        return;
      }

      if (currentGroup.find((_tx) => _tx.buy.user.address === tx.buy.user.address)) {
        // find nearest non-full group without repeating address
        const suitableExistingGroups = [...result.entries()].filter(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ([_, transactions]) =>
            transactions.length < maxGroupSize &&
            !transactions.find((_tx) => _tx.buy.user.address === tx.buy.user.address),
        );

        if (suitableExistingGroups.length) {
          const [key, group] = suitableExistingGroups[0];
          result.set(key, [...group, tx]);

          return;
        }

        const newGroup = [tx];
        result.set(result.size + 1, newGroup);

        return;
      }

      if (currentGroup.length >= maxGroupSize) {
        const newGroup = [tx];
        result.set(currentGroupNumber + 1, newGroup);
        currentGroupNumber++;

        return;
      }

      result.set(currentGroupNumber, [...currentGroup, tx]);
    });

    return [...result.values()];
  }

  private fixRoundingMismatch(): void {
    const transactionsTotal = this.transactions.reduce((acc, t) => acc + t.outputAmount, 0);

    const mismatch = Util.round(this.outputAmount - transactionsTotal, 8);

    if (mismatch === 0) {
      return;
    }

    if (Math.abs(mismatch) > 0 && Math.abs(mismatch) < 0.00001) {
      this.transactions[0].outputAmount = Util.round(this.transactions[0].outputAmount + mismatch, 8);
      console.info(
        `Fixed total output amount mismatch of ${mismatch} ${this.outputAsset}. Added to transaction ID: ${this.transactions[0].id}`,
      );
    } else {
      throw new Error(`Output amount mismatch is too high. Mismatch: ${mismatch} ${this.outputAsset}`);
    }
  }
}
