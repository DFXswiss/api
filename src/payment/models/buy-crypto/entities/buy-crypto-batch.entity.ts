import { IEntity } from 'src/shared/models/entity';
import { Util } from 'src/shared/util';
import { Column, Entity, OneToMany } from 'typeorm';
import { BuyCrypto } from './buy-crypto.entity';

export enum BuyCryptoBatchStatus {
  CREATED = 'created',
  SECURED = 'secured',
  PENDING_LIQUIDITY = 'pending-liquidity',
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

  recordDexToOutTransfer(txId: string): this {
    this.outTxId = txId;

    return this;
  }

  private fixRoundingMismatch(): void {
    const transactionsTotal = this.transactions.reduce((acc, t) => acc + t.outputAmount, 0);

    const mismatch = Util.round(this.outputAmount - transactionsTotal, 8);

    if (mismatch === 0) {
      return;
    }

    if (Math.abs(mismatch) > 0 && Math.abs(mismatch) < 0.00001) {
      this.transactions[0].outputAmount += mismatch;
      console.info(
        `Fixed total output amount mismatch of ${mismatch} ${this.outputAsset}. Added to transaction ID: ${this.transactions[0].id}`,
      );
    } else {
      throw new Error(`Output amount mismatch is too high. Mismatch: ${mismatch} ${this.outputAsset}`);
    }
  }
}
