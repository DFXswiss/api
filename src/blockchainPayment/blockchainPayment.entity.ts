import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Asset } from 'src/asset/asset.entity';

export enum BlockchainPaymentType {
    REFILL = 'Refill',
    INTERNALPAYMENT = 'Internal-Payment',
    SWAP = 'Swap',
    PAYOUT = 'Payout'
}


@Entity()
export class BlockchainPayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  type: BlockchainPaymentType;

  @Column({ type: 'varchar', length: 256 })
  command: string;

  @Column({ type: 'varchar', length: 256 })
  tx: string;

  @Column({ type: 'float', nullable: true })
  assetValue: number;

  @ManyToOne(() => Asset, { eager: true })
  @JoinColumn()
  asset: Asset;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn() 
  created: Date;
}