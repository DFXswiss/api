import { Country } from 'src/shared/models/country/country.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { BankData } from 'src/user/models/bankData/bankData.entity';
import { User } from 'src/user/models/user/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { SpiderData } from '../spider-data/spider-data.entity';
import { AccountType } from './account-type.enum';

export enum KycStatus {
  NA = 'NA',
  WAIT_CHAT_BOT = 'Chatbot',
  WAIT_ADDRESS = 'Address',
  WAIT_ONLINE_ID = 'OnlineId',
  WAIT_VIDEO_ID = 'VideoId',
  WAIT_MANUAL = 'Manual',
  COMPLETED = 'Completed',
}

export enum KycState {
  NA = 'NA',
  FAILED = 'Failed',
  REMINDED = 'Reminded',
  RETRIED = 'Retried',
}

export enum RiskState {
  A = 'a',
  B = 'b',
  C = 'c',
}

@Entity()
export class UserData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: true })
  isMigrated: boolean;

  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  firstname: string;

  @Column({ length: 256, nullable: true })
  surname: string;

  @Column({ length: 256, nullable: true })
  street: string;

  @Column({ length: 256, nullable: true })
  houseNumber: string;

  @Column({ length: 256, nullable: true })
  location: string;

  @Column({ length: 256, nullable: true })
  zip: string;

  @ManyToOne(() => Country, { eager: true })
  country: Country;

  @Column({ length: 256, nullable: true })
  organizationName: string;

  @Column({ length: 256, nullable: true })
  organizationStreet: string;

  @Column({ length: 256, nullable: true })
  organizationHouseNumber: string;

  @Column({ length: 256, nullable: true })
  organizationLocation: string;

  @Column({ length: 256, nullable: true })
  organizationZip: string;

  @ManyToOne(() => Country, { eager: true })
  organizationCountry: Country;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true })
  language: Language;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ length: 256, default: KycState.NA })
  kycState: KycState;

  @Column({ length: 256, nullable: true })
  riskState: RiskState;

  @Column({ type: 'float', default: 90000 })
  depositLimit: number;

  @Column({ type: 'integer', nullable: true })
  contributionAmount: number;

  @Column({ length: 256, nullable: true })
  contributionCurrency: string;

  @Column({ length: 256, nullable: true })
  plannedContribution: string;

  @Column({ type: 'integer', nullable: true })
  kycFileId: number;

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToOne(() => BankData, { nullable: true })
  @JoinColumn()
  mainBankData: BankData;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @OneToOne(() => SpiderData, (c) => c.userData, { nullable: true })
  spiderData: SpiderData;

  @UpdateDateColumn()
  updated: Date;

  @CreateDateColumn()
  created: Date;
}
