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

  addOutputReferenceAmount(amount: number): this {
    this.outputReferenceAmount = this.outputReferenceAmount + amount;

    return this;
  }

  secure(): this {
    this.status = BuyCryptoBatchStatus.SECURED;

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
