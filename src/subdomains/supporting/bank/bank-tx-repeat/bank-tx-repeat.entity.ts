import { Entity, OneToOne, JoinColumn, Column, ManyToOne } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { BankTx } from '../bank-tx/bank-tx.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

@Entity()
export class BankTxRepeat extends IEntity {
  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  sourceBankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  @ManyToOne(() => User, { nullable: true })
  user: User;

  @Column({ length: 256, nullable: true })
  info: string;

  @Column({ type: 'float', nullable: true })
  amountInChf: number;

  @Column({ type: 'float', nullable: true })
  amountInEur: number;

  @Column({ type: 'float', nullable: true })
  amountInUsd: number;
}
