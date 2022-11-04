import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Column, Entity, ManyToOne } from 'typeorm';
import { UserData } from '../user-data/user-data.entity';

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
}

@Entity()
export class LimitRequest extends IEntity {
  @Column({ type: 'integer' })
  limit: number;

  @Column({ length: 256 })
  investmentDate: InvestmentDate;

  @Column({ length: 256 })
  fundOrigin: FundOrigin;

  @Column({ length: 256, nullable: true })
  fundOriginText: string;

  @Column({ length: 256, nullable: true })
  documentProofUrl: string;

  @Column({ length: 256, nullable: true })
  decision: LimitRequestDecision;

  @Column({ length: 256, nullable: true })
  clerk: string;

  @Column({ type: 'datetime2', nullable: true })
  edited: Date;

  //Mail
  @Column({ length: 256, nullable: true })
  recipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  mailSendDate: Date;

  // References

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;

  // Methods
  sendMail(): UpdateResult<LimitRequest> {
    this.recipientMail = this.userData.mail;
    this.mailSendDate = new Date();

    return [this.id, { recipientMail: this.recipientMail, mailSendDate: this.mailSendDate }];
  }
}
