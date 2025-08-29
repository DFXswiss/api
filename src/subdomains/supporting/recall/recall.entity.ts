import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { CheckoutTx } from '../fiat-payin/entities/checkout-tx.entity';

@Entity()
@Index((r: Recall) => [r.bankTx, r.checkoutTx, r.sequence], { unique: true })
export class Recall extends IEntity {
  @ManyToOne(() => BankTx)
  bankTx: BankTx;

  @ManyToOne(() => CheckoutTx)
  checkoutTx: CheckoutTx;

  @Column({ type: 'int' })
  sequence: number;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column({ length: 'MAX' })
  comment: string;

  @Column({ type: 'float' })
  fee: number;
}
