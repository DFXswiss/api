import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BankTx } from '../bank-tx/bank-tx/entities/bank-tx.entity';
import { RecallReason } from './recall-reason.enum';

@Entity()
@Index((r: Recall) => [r.bankTx, r.sequence], { unique: true })
export class Recall extends IEntity {
  @ManyToOne(() => BankTx)
  bankTx: BankTx;

  @Column({ type: 'int' })
  sequence: number;

  @ManyToOne(() => User, { nullable: true })
  user?: User;

  @Column({ length: 'MAX' })
  comment: string;

  @Column({ type: 'float' })
  fee: number;

  @Column({ length: 256, nullable: true })
  reason?: RecallReason;
}
