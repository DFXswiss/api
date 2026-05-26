import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { CheckoutTx } from '../fiat-payin/entities/checkout-tx.entity';
import { RecallReason } from './recall-reason.enum';

@Entity()
@Index((r: Recall) => [r.bankTx, r.checkoutTx, r.sequence], { unique: true })
export class Recall extends IEntity {
  @Index()
  @ManyToOne(() => BankTx)
  bankTx: BankTx;

  @Index()
  @ManyToOne(() => CheckoutTx)
  checkoutTx: CheckoutTx;

  @Column({ type: 'int' })
  sequence: number;

  @Index()
  @ManyToOne(() => User, { nullable: true })
  user?: User;

  @Column({ type: 'text' })
  comment: string;

  @Column({ type: 'float' })
  fee: number;

  @Column({ length: 256, nullable: true })
  reason?: RecallReason;
}
