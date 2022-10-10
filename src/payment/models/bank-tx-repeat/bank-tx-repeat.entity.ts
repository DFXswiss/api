import { Entity, OneToOne, JoinColumn } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { BankTx } from '../bank-tx/bank-tx.entity';

@Entity()
export class BankTxRepeat extends IEntity {
  @OneToOne(() => BankTx, { nullable: false })
  @JoinColumn()
  bankTx: BankTx;
}
