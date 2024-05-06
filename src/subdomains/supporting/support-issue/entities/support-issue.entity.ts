import { IEntity } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Transaction } from '../../payment/entities/transaction.entity';
import { SupportMessage } from './support-message.entity';

export enum SupportIssueState {
  CREATED = 'Created',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
}

export enum SupportIssueType {
  TRANSACTION_ISSUE = 'TransactionIssue',
}

export enum SupportIssueReason {
  FUNDS_NOT_RECEIVED = 'FundsNotReceived',
  OTHER = 'Other',
}

@Entity()
export class SupportIssue extends IEntity {
  @Column({ length: 256, default: SupportIssueState.CREATED })
  state: SupportIssueState;

  @Column({ length: 256, nullable: false })
  type: SupportIssueType;

  @Column({ length: 256, nullable: false })
  reason: SupportIssueReason;

  @Column({ length: 256, nullable: true })
  name: string;

  @Column({ length: 'MAX', nullable: true })
  description: string; // TODO: remove?

  @Column({ length: 256, nullable: true })
  fileUrl: string; // TODO: remove

  @ManyToOne(() => Transaction, (transaction) => transaction.supportIssues, { nullable: true, eager: true })
  transaction: Transaction;

  @OneToMany(() => SupportMessage, (supportMessage) => supportMessage.issue)
  messages: SupportMessage[];
}
