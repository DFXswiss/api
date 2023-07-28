import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankAccount } from 'src/subdomains/supporting/bank/bank-account/bank-account.entity';
import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from 'typeorm';
import { RiskResult } from '../../services/spider/dto/spider.dto';
import { SpiderData } from '../spider-data/spider-data.entity';
import { TradingLimit } from '../user/dto/user.dto';
import { AccountType } from './account-type.enum';

export enum KycStatus {
  NA = 'NA',
  CHATBOT = 'Chatbot',
  ONLINE_ID = 'OnlineId',
  VIDEO_ID = 'VideoId',
  CHECK = 'Check',
  COMPLETED = 'Completed',
  REJECTED = 'Rejected',
  TERMINATED = 'Terminated',
}

export enum KycState {
  NA = 'NA',
  FAILED = 'Failed',
  REMINDED = 'Reminded',
  REVIEW = 'Review',
}

export enum KycType {
  DFX = 'DFX',
  LOCK = 'LOCK',
}

export enum KycIdentificationType {
  ONLINE_ID = 'OnlineId',
  VIDEO_ID = 'VideoId',
  MANUAL = 'Manual',
}

export enum RiskState {
  A = 'a',
  B = 'b',
  C = 'c',
}

export enum BlankType {
  PHONE,
  MAIL,
  WALLET_ADDRESS,
}

export enum LimitPeriod {
  DAY = 'Day',
  YEAR = 'Year',
}

export enum UserDataStatus {
  NA = 'NA',
  ACTIVE = 'Active',
  BLOCKED = 'Blocked',
  MERGED = 'Merged',
}

@Entity()
export class UserData extends IEntity {
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

  @ManyToOne(() => Country, { eager: true, nullable: true })
  nationality: Country;

  @Column({ type: 'datetime2', nullable: true })
  birthday: Date;

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

  @Column({ length: 256, default: UserDataStatus.NA })
  status: UserDataStatus;

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

  @Column({ length: 256, nullable: true })
  kycType: KycType;

  @Column({ type: 'float', nullable: true })
  depositLimit: number;

  @Column({ type: 'integer', nullable: true })
  contribution: number;

  @Column({ length: 256, nullable: true })
  plannedContribution: string;

  @Column({ type: 'datetime2', nullable: true })
  letterSentDate: Date;

  @Column({ type: 'datetime2', nullable: true })
  amlListAddedDate: Date;

  @Column({ length: 256, nullable: true })
  identificationType: KycIdentificationType;

  @Column({ length: 256, nullable: true })
  internalAmlNote: string;

  @Column({ nullable: true })
  pep: boolean;

  @Column({ length: 256, nullable: true })
  bankTransactionVerification: CheckStatus;

  //Mail
  @Column({ length: 256, nullable: true })
  blackSquadRecipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  blackSquadMailSendDate: Date;

  // Volumes
  @Column({ type: 'float', default: 0 })
  annualBuyVolume: number;

  @Column({ type: 'float', default: 0 })
  buyVolume: number;

  @Column({ type: 'float', default: 0 })
  annualSellVolume: number;

  @Column({ type: 'float', default: 0 })
  sellVolume: number;

  @Column({ type: 'float', default: 0 })
  annualCryptoVolume: number;

  @Column({ type: 'float', default: 0 })
  cryptoVolume: number;

  // References
  @OneToMany(() => BankAccount, (bankAccount) => bankAccount.userData)
  bankAccounts: BankAccount[];

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToOne(() => BankData, { nullable: true })
  @JoinColumn()
  mainBankData: BankData;

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

  @OneToOne(() => SpiderData, (c) => c.userData, { nullable: true })
  spiderData: SpiderData;

  // Methods
  sendMail(): UpdateResult<UserData> {
    this.blackSquadRecipientMail = this.mail;
    this.blackSquadMailSendDate = new Date();

    return [
      this.id,
      { blackSquadRecipientMail: this.blackSquadRecipientMail, blackSquadMailSendDate: this.blackSquadMailSendDate },
    ];
  }

  get isDfxUser(): boolean {
    return this.kycType === KycType.DFX;
  }

  get hasActiveUser(): boolean {
    return !!this.users.find((e) => e.status === UserStatus.ACTIVE);
  }

  get tradingLimit(): TradingLimit {
    if (KycCompleted(this.kycStatus)) {
      return { limit: this.depositLimit, period: LimitPeriod.YEAR };
    } else if (this.kycStatus === KycStatus.REJECTED) {
      return { limit: 0, period: LimitPeriod.DAY };
    } else {
      return { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY };
    }
  }

  set riskResult({ result, risks }: RiskResult) {
    this.riskState = result;
    this.riskRoots = result === 'c' ? null : JSON.stringify(risks);
  }
}

export const KycInProgressStates = [KycStatus.CHATBOT, KycStatus.ONLINE_ID, KycStatus.VIDEO_ID];
export const IdentInProgressStates = [KycStatus.ONLINE_ID, KycStatus.VIDEO_ID];
export const KycCompletedStates = [KycStatus.COMPLETED];
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
    case BlankType.WALLET_ADDRESS:
      return `${value.substring(0, 4)}${createStringOf('*', 8)}${value.substring(value.length - 4)}`;
  }
}

function createStringOf(character: string, length: number): string {
  return ''.padStart(length, character);
}
