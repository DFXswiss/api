import { Entity, OneToOne, JoinColumn, Column } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { BankTx } from '../bank-tx/bank-tx.entity';

@Entity()
export class BankTxReturn extends IEntity {
  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;

  @OneToOne(() => BankTx, { nullable: true })
  @JoinColumn()
  chargebackBankTx: BankTx;

  @Column({ length: 256, nullable: true })
  info: string;
}
