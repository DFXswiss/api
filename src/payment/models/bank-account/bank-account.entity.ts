import { Entity, Column, Index, ManyToOne, OneToMany } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/user/models/user/user.entity';
import { Buy } from '../buy/buy.entity';
import { Sell } from '../sell/sell.entity';

export interface BankAccountInfos {
  result: string;
  returnCode: number;
  checks: string;
  bic: string;
  allBicCandidates: string;
  bankCode: string;
  bankAndBranchCode: string;
  bankName: string;
  bankAddress: string;
  bankUrl: string;
  branch: string;
  branchCode: string;
  sct: boolean;
  sdd: boolean;
  b2b: boolean;
  scc: boolean;
  sctInst: boolean;
  sctInstReadinessDate: Date;
  acountNumber: string;
  dataAge: string;
  ibanListed: string;
  ibanWwwOccurrences: number;
}

@Entity()
@Index('ibanLabel', (bankAccount: BankAccount) => [bankAccount.iban, bankAccount.user], {
  unique: true,
})
export class BankAccount extends IEntity implements BankAccountInfos {
  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  label: string;

  @ManyToOne(() => User, (user) => user.bankAccounts, { nullable: false })
  user: User;

  @OneToMany(() => Buy, (buy) => buy.bankAccount)
  buys: Buy[];

  @OneToMany(() => Sell, (sell) => sell.bankAccount)
  sells: Sell[];

  @Column({ length: 256, nullable: true })
  result: string;

  @Column({ nullable: true })
  returnCode: number;

  @Column({ length: 256, nullable: true })
  checks: string;

  @Column({ length: 256, nullable: true })
  bic: string;

  @Column({ length: 256, nullable: true })
  allBicCandidates: string;

  @Column({ length: 256, nullable: true })
  bankCode: string;

  @Column({ length: 256, nullable: true })
  bankAndBranchCode: string;

  @Column({ length: 256, nullable: true })
  bankName: string;

  @Column({ length: 256, nullable: true })
  bankAddress: string;

  @Column({ length: 256, nullable: true })
  bankUrl: string;

  @Column({ length: 256, nullable: true })
  branch: string;

  @Column({ length: 256, nullable: true })
  branchCode: string;

  @Column({ nullable: true })
  sct: boolean;

  @Column({ nullable: true })
  sdd: boolean;

  @Column({ nullable: true })
  b2b: boolean;

  @Column({ nullable: true })
  scc: boolean;

  @Column({ nullable: true })
  sctInst: boolean;

  @Column({ nullable: true, type: 'datetime2' })
  sctInstReadinessDate: Date;

  @Column({ length: 256, nullable: true })
  acountNumber: string;

  @Column({ length: 256, nullable: true })
  dataAge: string;

  @Column({ length: 256, nullable: true })
  ibanListed: string;

  @Column({ nullable: true })
  ibanWwwOccurrences: number;
}
