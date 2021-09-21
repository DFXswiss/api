import { BlockchainPayment } from 'src/blockchainPayment/blockchainPayment.entity';
import { Payment } from 'src/payment/models/payment/payment.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany, UpdateDateColumn } from 'typeorm';

@Entity()
export class Batch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256, unique: true })
  name: string;

  @Column({ type: 'float', nullable: true })
  balanceBefore: number;

  @Column({ type: 'float', nullable: true })
  balanceAfter: number;

  //TODO payment über richtige Spalte referenzieren
  @OneToMany(() => Payment, (payment) => payment.asset)
  payments: Payment[];

  //TODO blockchainPayment referenzieren
  @OneToMany(() => BlockchainPayment, (blockchainPayment) => blockchainPayment.id)
  blockchainPayments: BlockchainPayment[];

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
