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
  @OneToMany(() => BuyCrypto, (buyCrypto) => buyCrypto.batch)
  transactions: BuyCrypto[];

  @Column({ length: 256, nullable: false })
  outputReferenceAsset: string;

  @Column({ length: 256, nullable: true })
  outputReferenceAmount: number;

  @Column({ length: 256, nullable: false })
  outputAsset: string;

  @Column({ length: 256, nullable: true })
  outputAmount: number;

  @Column({ length: 256, nullable: true })
  status: string;

  @Column({ length: 256, nullable: true })
  outTxId: string;

  @Column({ length: 256, nullable: true })
  purchaseTxId: string;

  @Column({ length: 256, nullable: true })
  lastCompleteBlock: number;

  addTransaction(tx: BuyCrypto): this {
    this.transactions.push(tx);
    this.outputReferenceAmount = this.outputReferenceAmount + tx.outputReferenceAmount;

    return this;
  }

  secure(liquidity: number): this {
    this.outputAmount = liquidity;
    this.status = BuyCryptoBatchStatus.SECURED;

    for (const tx of this.transactions) {
      tx.calculateOutputAmount(this.outputReferenceAmount, this.outputAmount);
    }

    return this;
  }

  recordBlockHeight(recentChainHistory: { txId: string; blockHeight: number }[]): this {
    for (const tx of this.transactions) {
      const chainTx = recentChainHistory.find((chainTx) => chainTx.txId === tx.txId);

      tx.recordBlockHeight(chainTx.blockHeight);
    }

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
