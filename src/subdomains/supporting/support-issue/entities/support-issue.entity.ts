import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, ManyToOne, OneToMany } from 'typeorm';
import { Transaction } from '../../payment/entities/transaction.entity';
import { SupportMessage } from './support-message.entity';

export enum SupportIssueState {
  CREATED = 'Created',
  PENDING = 'Pending',
  COMPLETED = 'Completed',
}

export enum SupportIssueType {
  GENERIC_ISSUE = 'GenericIssue',
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

  @Column({ length: 256, nullable: false })
  name: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.supportIssues, { nullable: true, eager: true })
  transaction: Transaction;

  @OneToMany(() => SupportMessage, (supportMessage) => supportMessage.issue)
  messages: SupportMessage[];

  @ManyToOne(() => UserData, { nullable: true, eager: true })
  userData: UserData;

  get userDataTemp(): UserData {
    return this.userData ?? this.transaction.user.userData;
  }
}
