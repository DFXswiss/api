import { Asset } from 'src/shared/models/asset/asset.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
import { Batch } from '../batch/batch.entity';

export enum BlockchainPaymentType {
  REFILL = 'Refill',
  INTERNAL_PAYMENT = 'InternalPayment',
  SWAP = 'Swap',
  PAYOUT = 'Payout',
}

@Entity()
export class BlockchainPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256 })
  type: BlockchainPaymentType;

  @Column({ length: 256 })
  command: string;

  @Column({ length: 256 })
  tx: string;

  @Column({ type: 'float', nullable: true })
  assetValue?: number;

  @ManyToOne(() => Asset, { eager: true })
  asset: Asset;

  @ManyToOne(() => Batch)
  batch: Batch;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
