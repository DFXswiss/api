import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { TransactionRequest } from '../../payment/entities/transaction-request.entity';
import { Transaction } from '../../payment/entities/transaction.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueReason, SupportIssueState, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueLog } from './support-issue-log.entity';
import { SupportMessage } from './support-message.entity';

@Entity()
export class SupportIssue extends IEntity {
  @Column({ length: 256, unique: true })
  uid: string;

  @Column({ length: 256, default: SupportIssueState.CREATED })
  state: SupportIssueState;

  @Column({ length: 256 })
  type: SupportIssueType;

  @Column({ length: 256, nullable: true })
  clerk?: string;

  @Column({ length: 256, nullable: true })
  department?: Department;

  @Column({ length: 256 })
  reason: SupportIssueReason;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 'MAX', nullable: true })
  information?: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.supportIssues, { nullable: true, eager: true })
  transaction?: Transaction;

  @ManyToOne(() => TransactionRequest, (request) => request.supportIssues, { nullable: true, eager: true })
  transactionRequest?: TransactionRequest;

  @OneToMany(() => SupportMessage, (supportMessage) => supportMessage.issue)
  messages: SupportMessage[];

  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  @OneToOne(() => LimitRequest, { nullable: true })
  @JoinColumn()
  limitRequest?: LimitRequest;

  @OneToMany(() => SupportIssueLog, (l) => l.supportIssue)
  logs: SupportIssueLog[];

  // --- ENTITY METHODS --- //

  setState(state: SupportIssueState): UpdateResult<SupportIssue> {
    const update: Partial<SupportIssue> = { state };

    Object.assign(this, update);

    return [this.id, update];
  }

  setClerk(clerk: string): UpdateResult<SupportIssue> {
    const update: Partial<SupportIssue> = { clerk };

    Object.assign(this, update);

    return [this.id, update];
  }

  set additionalInformation(info: object) {
    this.information = JSON.stringify(info);
  }

  get additionalInformation(): object | undefined {
    return this.information && JSON.parse(this.information);
  }

  get url(): string {
    return `${Config.frontend.services}/support/chat/${this.uid}`;
  }
}
