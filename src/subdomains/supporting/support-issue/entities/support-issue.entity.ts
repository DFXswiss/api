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

// The "All tickets" screen pages the closed-ticket tabs (state = X ORDER BY created DESC, id DESC
// LIMIT n) over hundreds of thousands of rows; with only FK columns indexed that was a full seq scan
// + top-N sort on every page load. This composite is state-leading, so Postgres serves each tab with
// an index-scan-backward that stops after the requested page (verified ~98ms -> 0.06ms on a 1M-row
// set via EXPLAIN); the (created, id) tail matches the exact sort + tiebreak, and deep pages stay
// cheap. It also serves the open-ticket overview (state IN (...)) via a bitmap scan. Not used by the
// RealUnit customerIds path (filters via the userData join). Note: the per-tab COUNT(*) badges from
// getManyAndCount/getIssueCounts stay on a seq scan and are a separate concern. See
// support-issue.service.ts getSupportIssueList.
@Index((issue: SupportIssue) => [issue.state, issue.created, issue.id])
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

  // Wallet/app the issue was opened from, resolved exactly from the inbound X-Client header at creation
  // (NOT the user's persisted wallet) - drives mail branding. NOT NULL: every creation path must attribute
  // an exact source or fail; legacy rows were backfilled to the DFX default wallet by the migration.
  @Index()
  @ManyToOne(() => Wallet, { nullable: false, eager: true })
  wallet: Wallet;

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
