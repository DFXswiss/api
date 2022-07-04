import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { Column, Entity, OneToMany } from 'typeorm';
import { BuyCrypto } from './buy-crypto.entity';

export enum BuyCryptoBatchStatus {
  CREATED = 'Created',
  SECURED = 'Secured',
  PENDING_LIQUIDITY = 'PendingLiquidity',
  PAYING_OUT = 'PayingOut',
  COMPLETE = 'Complete',
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
  status: BuyCryptoBatchStatus;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  purchaseTxId: string;

  addTransaction(tx: BuyCrypto): this {
    tx.batch = this;

    this.transactions = [...(this.transactions ?? []), tx];

    this.outputReferenceAmount = Util.round((this.outputReferenceAmount ?? 0) + tx.outputReferenceAmount, 8);

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
    if (!(this.status === BuyCryptoBatchStatus.SECURED || this.status === BuyCryptoBatchStatus.PAYING_OUT)) {
      throw new Error(
        `Cannot payout batch which is not secured or paying-out. Batch ID: ${this.id}. Batch status: ${this.status}`,
      );
    }

    // filtering out transactions that were already sent
    const payoutTransactions = this.transactions.filter((tx) => !tx.txId);

    payoutTransactions.length === this.transactions.length &&
      console.info(`Grouping transactions for payout. Batch ID: ${this.id}`);

    const maxGroupSize = this.outputAsset === 'DFI' ? 100 : 10;
    const groups = this.createPayoutGroups(payoutTransactions, maxGroupSize);

    payoutTransactions.length === this.transactions.length &&
      console.info(`Created ${groups.length} transaction group(s) for payout. Batch ID: ${this.id}`);

    return groups;
  }

  get minimalOutputReferenceAmount(): number {
    return this.outputReferenceAsset === 'BTC' ? 0.001 : 1;
  }

  private createPayoutGroups(transactions: BuyCrypto[], maxGroupSize: number): BuyCrypto[][] {
    const result: Map<number, BuyCrypto[]> = new Map();

    transactions.forEach((tx) => {
      const targetAddress = tx.buy.deposit ? tx.buy.deposit.address : tx.buy.user.address;
      // find nearest non-full group without repeating address
      const suitableExistingGroups = [...result.entries()].filter(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ([_, transactions]) =>
          transactions.length < maxGroupSize &&
          !transactions.find((_tx) => {
            const _targetAddress = _tx.buy.deposit ? _tx.buy.deposit.address : _tx.buy.user.address;
            return _targetAddress === targetAddress;
          }),
      );

      const [key, group] = suitableExistingGroups[0] ?? [result.size, []];
      result.set(key, [...group, tx]);
    });

    return [...result.values()];
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
