import { BlockchainPayment } from 'src/payment/models/blockchain-payment/blockchain-payment.entity';
import { Payment } from 'src/payment/models/payment/payment.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';

@Entity()
export class Batch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 256, unique: true })
  name: string;

  @Column({ type: 'float', nullable: true })
  balanceBefore: number;

  @Column({ type: 'float', nullable: true })
  balanceAfter: number;

  @OneToMany(() => Payment, (payment) => payment.batch)
  payments: Payment[];

  @OneToMany(() => BlockchainPayment, (blockchainPayment) => blockchainPayment.batch)
  blockchainPayments: BlockchainPayment[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
