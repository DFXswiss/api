import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Buy } from 'src/subdomains/core/buy-crypto/routes/buy/buy.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { Sell } from '../../../core/sell-crypto/route/sell.entity';

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
  accountNumber: string;
  dataAge: string;
  ibanListed: string;
  ibanWwwOccurrences: number;
}

@Entity()
@Index((account: BankAccount) => [account.iban, account.userData], { unique: true })
export class BankAccount extends IEntity implements BankAccountInfos {
  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  label: string;

  @ManyToOne(() => UserData, (user) => user.bankAccounts, { nullable: true })
  userData: UserData;

  @ManyToOne(() => Fiat, { nullable: true, eager: true })
  preferredCurrency: Fiat;

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

  @Column({ length: 'MAX', nullable: true })
  bic: string;

  @Column({ length: 'MAX', nullable: true })
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

  @Column({ type: 'datetime2', nullable: true })
  sctInstReadinessDate: Date;

  @Column({ length: 256, nullable: true })
  accountNumber: string;

  @Column({ length: 256, nullable: true })
  dataAge: string;

  @Column({ length: 256, nullable: true })
  ibanListed: string;

  @Column({ nullable: true })
  ibanWwwOccurrences: number;

  @Column({ default: true })
  active: boolean;
}
