import { Entity, Column, Index, ManyToOne, OneToMany } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/user/models/user/user.entity';
import { Buy } from '../buy/buy.entity';
import { Sell } from '../sell/sell.entity';

@Entity()
@Index('ibanLabel', (bankAccount: BankAccount) => [bankAccount.iban, bankAccount.user], {
  unique: true,
})
export class BankAccount extends IEntity {
  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  label: string;

  @ManyToOne(() => User, (user) => user.ibans)
  user: User;

  @OneToMany(() => Buy, (buy) => buy.bankAccount)
  buy: Buy[];

  @OneToMany(() => Sell, (sell) => sell.bankAccount)
  sell: Sell[];

  @Column({ length: 256, nullable: true })
  bic: string;

  @Column({ length: 256, nullable: true })
  allBicCandidates: string;

  @Column({ length: 256, nullable: true })
  country: string;

  @Column({ length: 256, nullable: true })
  bankCode: string;

  @Column({ length: 256, nullable: true })
  bankAndBranchCode: string;

  @Column({ length: 256, nullable: true })
  bankName: string;

  @Column({ length: 256, nullable: true })
  bankAddress: string;

  @Column({ length: 256, nullable: true })
  bankCity: string;

  @Column({ length: 256, nullable: true })
  bankState: string;

  @Column({ length: 256, nullable: true })
  bankPostalCode: string;

  @Column({ length: 256, nullable: true })
  bankUrl: string;

  @Column({ length: 256, nullable: true })
  branch: string;

  @Column({ nullable: true })
  branchCode: number;

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

  @Column({ nullable: true })
  sctInstReadinessDate: string;

  @Column({ nullable: true })
  acountNumber: number;

  @Column({ length: 256, nullable: true })
  dataAge: string;

  @Column({ length: 256, nullable: true })
  ibanListed: string;
}
