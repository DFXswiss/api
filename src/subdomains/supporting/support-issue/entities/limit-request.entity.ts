import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { Column, Entity, OneToMany, OneToOne } from 'typeorm';
import { LimitRequestLog } from './limit-request-log.entity';

export enum InvestmentDate {
  NOW = 'Now',
  FUTURE = 'Future',
}

export enum FundOrigin {
  SAVINGS = 'Savings',
  BUSINESS_PROFITS = 'BusinessProfits',
  STOCK_GAINS = 'StockGains',
  CRYPTO_GAINS = 'CryptoGains',
  INHERITANCE = 'Inheritance',
  OTHER = 'Other',
}

export enum LimitRequestDecision {
  ACCEPTED = 'Accepted',
  PARTIALLY_ACCEPTED = 'PartiallyAccepted',
  REJECTED = 'Rejected',
  EXPIRED = 'Expired',
  CLOSED = 'Closed',
}

@Entity()
export class LimitRequest extends IEntity {
  @Column({ type: 'integer' })
  limit: number;

  @Column({ length: 256 })
  investmentDate: InvestmentDate;

  @Column({ length: 256 })
  fundOrigin: FundOrigin;

  @Column({ length: 'MAX', nullable: true })
  fundOriginText?: string;

  @Column({ length: 256, nullable: true })
  decision?: LimitRequestDecision;

  @Column({ length: 256, nullable: true })
  clerk?: string;

  @Column({ type: 'datetime2', nullable: true })
  edited?: Date;

  //Mail
  @Column({ length: 256, nullable: true })
  recipientMail?: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate?: Date;

  // References

  @OneToOne(() => SupportIssue, (supportIssue) => supportIssue.limitRequest, { nullable: false, eager: true })
  supportIssue: SupportIssue;

  @OneToMany(() => LimitRequestLog, (l) => l.limitRequest)
  logs: LimitRequestLog[];

  // Methods
  sendMail(): UpdateResult<LimitRequest> {
    this.recipientMail = this.userData.mail;
    this.mailSendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mailSendDate: this.mailSendDate }];
  }

  get userData(): UserData {
    return this.supportIssue.userData;
  }
}

export const LimitRequestAcceptedStates = [LimitRequestDecision.ACCEPTED, LimitRequestDecision.PARTIALLY_ACCEPTED];

export function LimitRequestAccepted(decision?: LimitRequestDecision): boolean {
  return LimitRequestAcceptedStates.includes(decision);
}
