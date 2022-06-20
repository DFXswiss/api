import { Entity, Column, Index, ManyToOne, OneToMany } from 'typeorm';
import { IEntity } from 'src/shared/models/entity';
import { User } from 'src/user/models/user/user.entity';
import { Buy } from '../buy/buy.entity';
import { Sell } from '../sell/sell.entity';

@Entity()
@Index('ibanLabel', (bankAccount: BankAccount) => [bankAccount.iban, bankAccount.label, bankAccount.user], {
  unique: true,
})
export class BankAccount extends IEntity {
  @Column({ length: 256 })
  iban: string;

  @Column({ length: 256, nullable: true })
  label: string;

  @ManyToOne(() => User, (user) => user.ibans)
  user: User;

  @OneToMany(() => Buy || Sell, (route) => route.bankAccount)
  routes: Buy[] | Sell[];

  @Column({ length: 256 })
  bic: string;

  @Column({ length: 256 })
  allBicCandidates: string;

  @Column({ length: 256 })
  country: string;

  @Column({ length: 256 })
  bankCode: string;

  @Column({ length: 256 })
  bankAndBranchCode: string;

  @Column({ length: 256 })
  bankName: string;

  @Column({ length: 256 })
  bankAddress: string;

  @Column({ length: 256 })
  bankCity: string;

  @Column({ length: 256 })
  bankState: string;

  @Column({ length: 256 })
  bankPostalCode: string;

  @Column({ length: 256 })
  bankUrl: string;

  @Column({ length: 256 })
  branch: string;

  @Column({ nullable: true })
  branchCode: number;

  @Column({})
  sct: boolean;

  @Column({})
  sdd: boolean;

  @Column({})
  b2b: boolean;

  @Column({})
  scc: boolean;

  @Column({})
  sctInst: boolean;

  @Column({})
  sctInstReadinessDate: Date;

  @Column({})
  acountNumber: number;

  @Column({ length: 256 })
  dataAge: string;

  @Column({ length: 256 })
  ibanListed: string;
}
