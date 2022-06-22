import { IEntity } from 'src/shared/models/entity';
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

  @Column({ type: 'float', nullable: true })
  lastCompleteBlock: number;

  addTransaction(tx: BuyCrypto): this {
    if (!this.transactions) {
      this.transactions = [];
    }

    tx.batch = this;

    this.transactions = [...this.transactions, tx];

    if (!this.outputReferenceAmount) {
      this.outputReferenceAmount = 0;
    }

    this.outputReferenceAmount = this.outputReferenceAmount + tx.outputReferenceAmount;

    return this;
  }

  secure(liquidity: number): this {
    console.log('Secure Before');
    this.outputAmount = liquidity;
    this.status = BuyCryptoBatchStatus.SECURED;

    // don't forget to solve rounding issue here!
    // and maybe add a specification???
    const updatedTransactions = this.transactions.map((t) =>
      t.calculateOutputAmount(this.outputReferenceAmount, this.outputAmount),
    );

    this.transactions = updatedTransactions;

    console.log('Secure After', this);
    return this;
  }

  recordBlockHeight(recentChainHistory: { txId: string; blockHeight: number }[]): this {
    const updatedTransactions = this.transactions.map((t) => {
      const chainTx = recentChainHistory.find((chainTx) => chainTx.txId === t.txId);

      return t.recordBlockHeight(chainTx.blockHeight);
    });

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

  recordOutToDexTransfer(txId: string): this {
    this.outTxId = txId;

    return this;
  }
}
