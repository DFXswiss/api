import { Config } from 'src/config/config';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { LimitRequest } from 'src/subdomains/supporting/support-issue/entities/limit-request.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { TransactionRequest } from '../../payment/entities/transaction-request.entity';
import { Transaction } from '../../payment/entities/transaction.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState, SupportIssueReason, SupportIssueType } from '../enums/support-issue.enum';
import { SupportIssueLog } from './support-issue-log.entity';
import { SupportMessage } from './support-message.entity';

@Entity()
export class SupportIssue extends IEntity {
  @Column({ length: 256, unique: true })
  uid: string;

  @Column({ length: 256, default: SupportIssueInternalState.CREATED })
  state: SupportIssueInternalState;

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

  @Column({ type: 'text', nullable: true })
  information?: string;

  @Index()
  @ManyToOne(() => Transaction, (transaction) => transaction.supportIssues, { nullable: true, eager: true })
  transaction?: Transaction;

  @Index()
  @ManyToOne(() => TransactionRequest, (request) => request.supportIssues, { nullable: true, eager: true })
  transactionRequest?: TransactionRequest;

  @OneToMany(() => SupportMessage, (supportMessage) => supportMessage.issue)
  messages: SupportMessage[];

  @Index()
  @ManyToOne(() => UserData, { nullable: false, eager: true })
  userData: UserData;

  // wallet the issue was opened from (e.g. DFX vs. RealUnit app) - drives mail branding; null for legacy/support-created issues
  @Index()
  @ManyToOne(() => Wallet, { nullable: true, eager: true })
  wallet?: Wallet;

  @OneToOne(() => LimitRequest, { nullable: true })
  @JoinColumn()
  limitRequest?: LimitRequest;

  @OneToMany(() => SupportIssueLog, (l) => l.supportIssue)
  logs: SupportIssueLog[];

  // --- ENTITY METHODS --- //

  setState(state: SupportIssueInternalState): UpdateResult<SupportIssue> {
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
