import { Payment } from 'src/payment/payment.entity';
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

  @OneToMany(() => Payment, (payment) => payment.asset)
  payments: Payment[];

  //TODO blockchainPayment referenzieren

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
