import { Country } from 'src/shared/models/country/country.entity';
import { IEntity } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { BankData } from 'src/user/models/bank-data/bank-data.entity';
import { User } from 'src/user/models/user/user.entity';
import { Entity, Column, OneToMany, OneToOne, JoinColumn, ManyToOne, Index, Generated } from 'typeorm';
import { SpiderData } from '../spider-data/spider-data.entity';
import { AccountType } from './account-type.enum';

export enum KycStatus {
  NA = 'NA',
  CHATBOT = 'Chatbot',
  ONLINE_ID = 'OnlineId',
  VIDEO_ID = 'VideoId',
  CHECK = 'Check',
  MANUAL = 'Manual',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
}

export enum KycState {
  NA = 'NA',
  FAILED = 'Failed',
  REMINDED = 'Reminded',
  REVIEW = 'Review',
}

export enum RiskState {
  A = 'a',
  B = 'b',
  C = 'c',
}

export enum BlankType {
  PHONE,
  MAIL,
}

@Entity()
export class UserData extends IEntity {
  // TODO: remove
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

  @ManyToOne(() => Fiat, { eager: true })
  currency: Fiat;

  @Column({ length: 256, nullable: true })
  riskState: RiskState;

  @Column({ length: 'MAX', nullable: true })
  riskRoots: string;

  @Column({ nullable: true })
  highRisk: boolean;

  @Column({ nullable: true })
  complexOrgStructure: boolean;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ length: 256, default: KycState.NA })
  kycState: KycState;

  @Column({ type: 'datetime2', nullable: true })
  kycStatusChangeDate: Date;

  @Column({ type: 'integer', nullable: true })
  kycFileId: number;

  @Column({ type: 'integer', nullable: true })
  kycCustomerId: number;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  kycHash: string;

  @Column({ type: 'float', default: 90000 })
  depositLimit: number;

  @Column({ type: 'integer', nullable: true })
  contribution: number;

  @Column({ length: 256, nullable: true })
  plannedContribution: string;

  @Column({ type: 'float', default: 0 })
  annualBuyVolume: number;

  @Column({ type: 'float', default: 0 })
  buyVolume: number;

  @Column({ type: 'float', default: 0 })
  annualSellVolume: number;

  @Column({ type: 'float', default: 0 })
  sellVolume: number;

  @Column({ type: 'float', default: 0 })
  stakingBalance: number;

  @Column({ type: 'float', default: 0 })
  annualCryptoVolume: number;

  @Column({ type: 'float', default: 0 })
  cryptoVolume: number;

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToOne(() => BankData, { nullable: true })
  @JoinColumn()
  mainBankData: BankData;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @OneToOne(() => SpiderData, (c) => c.userData, { nullable: true })
  spiderData: SpiderData;
}

export const KycInProgressStates = [KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID];
export const IdentInProgressStates = [KycStatus.ONLINE_ID, KycStatus.VIDEO_ID];
export const KycCompletedStates = [KycStatus.MANUAL, KycStatus.COMPLETED];
export const IdentCompletedStates = [KycStatus.CHECK, ...KycCompletedStates];

export function KycInProgress(kycStatus?: KycStatus): boolean {
  return KycInProgressStates.includes(kycStatus);
}

export function IdentInProgress(kycStatus?: KycStatus): boolean {
  return IdentInProgressStates.includes(kycStatus);
}

export function KycCompleted(kycStatus?: KycStatus): boolean {
  return KycCompletedStates.includes(kycStatus);
}

export function IdentCompleted(kycStatus?: KycStatus): boolean {
  return IdentCompletedStates.includes(kycStatus);
}

const numberOfLastVisibleNumbers = 2;

export function Blank(value: string, type: BlankType): string {
  if (!value || value.length === 0) return value;
  switch (type) {
    case BlankType.PHONE:
      return `${createStringOf('*', value.length - numberOfLastVisibleNumbers)}${value.substring(
        value.length - numberOfLastVisibleNumbers,
      )}`;
    case BlankType.MAIL:
      const [name, domain] = value.split('@');
      return `${name[0]}${createStringOf('*', name.length - 1)}@${domain}`;
  }
}

function createStringOf(character: string, length: number): string {
  return ''.padStart(length, character);
}
