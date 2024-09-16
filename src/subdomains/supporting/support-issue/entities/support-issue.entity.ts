import { IEntity } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
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
  KYC_ISSUE = 'KycIssue',
  LIMIT_REQUEST = 'LimitRequest',
  PARTNERSHIP_REQUEST = 'PartnershipRequest',
  NOTIFICATION_OF_CHANGES = 'NotificationOfChanges',
}

export enum SupportIssueReason {
  OTHER = 'Other',

  // transaction
  FUNDS_NOT_RECEIVED = 'FundsNotReceived',
  TRANSACTION_MISSING = 'TransactionMissing',
}

@Entity()
export class SupportIssue extends IEntity {
  @Column({ length: 256, nullable: true })
  uid: string;

  @Column({ length: 256, default: SupportIssueState.CREATED })
  state: SupportIssueState;

  @Column({ length: 256, nullable: false })
  type: SupportIssueType;

  @Column({ length: 256, nullable: false })
  reason: SupportIssueReason;

  @Column({ length: 256, nullable: false })
  name: string;

  @Column({ length: 'MAX', nullable: true })
  information: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.supportIssues, { nullable: true, eager: true })
  transaction: Transaction;

  @OneToMany(() => SupportMessage, (supportMessage) => supportMessage.issue)
  messages: SupportMessage[];

  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @OneToOne(() => LimitRequest, { nullable: true })
  @JoinColumn()
  limitRequest: LimitRequest;

  set additionalInformation(info: object) {
    this.information = JSON.stringify(info);
  }

  get additionalInformation(): object | undefined {
    return this.information && JSON.parse(this.information);
  }
}
