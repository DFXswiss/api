import { IEntity } from 'src/shared/models/entity';
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

  @ManyToOne(() => UserData, { nullable: false })
  userData: UserData;
}
