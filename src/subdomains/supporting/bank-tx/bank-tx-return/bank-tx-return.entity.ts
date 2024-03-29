import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { Transaction } from '../../payment/entities/transaction.entity';
import { BankTx } from '../bank-tx/bank-tx.entity';

@Entity()
export class BankTxReturn extends IEntity {
  @OneToOne(() => BankTx, (bankTx) => bankTx.bankTxReturn, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  @OneToOne(() => Transaction, { eager: true, nullable: true })
  @JoinColumn()
  transaction: Transaction;

  @Column({ length: 256, nullable: true })
  info: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd: number;
}
