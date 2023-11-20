import { NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName, KycStepStatus, KycStepType, getKycStepIndex } from 'src/subdomains/generic/kyc/enums/kyc.enum';
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

export enum KycStatusNew {
  NA = 'NA',
  IN_PROGRESS = 'InProgress',
  IN_REVIEW = 'InReview',
  Light = 'Light',
  FULL = 'Full',
  PAUSED = 'Paused',
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
  private readonly logger = new DfxLogger(UserData);

  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256, default: UserDataStatus.NA })
  status: UserDataStatus;

  // KYC
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

  @Column({ length: 256, default: KycStatusNew.NA })
  kycStatusNew: KycStatusNew;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  kycHash: string;

  @Column({ length: 256, nullable: true })
  kycType: KycType;

  @OneToMany(() => KycStep, (step) => step.userData, { eager: true, cascade: true })
  kycSteps: KycStep[];

  @Column({ type: 'float', nullable: true })
  depositLimit: number;

  @Column({ type: 'integer', nullable: true })
  contribution: number;

  @Column({ length: 256, nullable: true })
  plannedContribution: string;

  @Column({ type: 'datetime2', nullable: true })
  letterSentDate: Date;

  @Column({ length: 256, nullable: true })
  identificationType: KycIdentificationType;

  @Column({ nullable: true })
  pep: boolean;

  @Column({ length: 256, nullable: true })
  bankTransactionVerification: CheckStatus;

  @Column({ type: 'datetime2', nullable: true })
  lastNameCheckDate: Date;

  // AML
  @Column({ type: 'datetime2', nullable: true })
  amlListAddedDate: Date;

  @Column({ length: 256, nullable: true })
  internalAmlNote: string;

  @Column({ length: 256, nullable: true })
  amlAccountType: string;

  // Mail
  @Column({ length: 256, nullable: true })
  blackSquadRecipientMail: string;

  @Column({ type: 'datetime2', nullable: true })
  blackSquadMailSendDate: Date;

  // Fee / Discounts
  @Column({ length: 256, nullable: true })
  individualFees: string; // semicolon separated id's

  // Volumes
  @Column({ type: 'float', default: 0 })
  annualBuyVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  buyVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  annualSellVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  sellVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  annualCryptoVolume: number; // CHF

  @Column({ type: 'float', default: 0 })
  cryptoVolume: number; // CHF

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

  // --- ENTITY METHODS --- //
  sendMail(): UpdateResult<UserData> {
    this.blackSquadRecipientMail = this.mail;
    this.blackSquadMailSendDate = new Date();

    return [
      this.id,
      { blackSquadRecipientMail: this.blackSquadRecipientMail, blackSquadMailSendDate: this.blackSquadMailSendDate },
    ];
  }

  blockUserData(): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      status: UserDataStatus.BLOCKED,
      kycStatus: KycStatus.TERMINATED,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  addFee(feeId: number): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      individualFees: !this.individualFees ? feeId.toString() : `${this.individualFees};${feeId}`,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  removeFee(feeId: number): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      individualFees: this.individualFeeList.filter((id) => id !== feeId).join(';'),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  refreshLastCheckedTimestamp(): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      lastNameCheckDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  get isDfxUser(): boolean {
    return this.kycType === KycType.DFX;
  }

  get individualFeeList(): number[] {
    return this.individualFees?.split(';')?.map(Number);
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

  get availableTradingLimit(): number {
    return this.tradingLimit.period === LimitPeriod.YEAR
      ? this.tradingLimit.limit - this.annualBuyVolume - this.annualSellVolume - this.annualCryptoVolume
      : this.tradingLimit.limit;
  }

  set riskResult({ result, risks }: RiskResult) {
    this.riskState = result;
    this.riskRoots = result === 'c' ? null : JSON.stringify(risks);
  }

  // --- KYC PROCESS --- //

  completeStep(kycStep: KycStep, result?: string): this {
    kycStep.complete(result);
    this.logger.verbose(`User ${this.id} completes step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  failStep(kycStep: KycStep, result?: string): this {
    kycStep.fail(result);

    if (!this.hasStepsInProgress) this.kycStatusNew = KycStatusNew.PAUSED;

    this.logger.verbose(`User ${this.id} fails step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  nextStep(kycStep: KycStep): this {
    this.kycSteps.push(kycStep);
    this.kycStatusNew = KycStatusNew.IN_PROGRESS;

    this.logger.verbose(`User ${this.id} starts step ${kycStep}`);

    return this;
  }

  kycProcessDone(): this {
    this.kycStatusNew = KycStatusNew.IN_REVIEW;

    this.logger.verbose(`User ${this.id} in review`);

    return this;
  }

  getStepsWith(name?: KycStepName, type?: KycStepType): KycStep[] {
    return this.kycSteps.filter((s) => (!name || s.name === name) && (!type || s.type === type));
  }

  getPendingStepWith(name?: KycStepName, type?: KycStepType): KycStep | undefined {
    return this.getStepsWith(name, type).find((s) => s.status === KycStepStatus.IN_PROGRESS);
  }

  getPendingStep(stepId: number): KycStep | undefined {
    return this.kycSteps.find((s) => s.id === stepId && s.status === KycStepStatus.IN_PROGRESS);
  }

  getPendingStepOrThrow(stepId: number): KycStep {
    const kycStep = this.getPendingStep(stepId);
    if (!kycStep) throw new NotFoundException('KYC step not found');

    return kycStep;
  }

  get hasStepsInProgress(): boolean {
    return this.kycSteps.some((s) => s.status === KycStepStatus.IN_PROGRESS);
  }

  getLastStep(): KycStepName | undefined {
    return Util.maxObj(
      this.kycSteps.map((s) => ({ name: s.name, index: getKycStepIndex(s.name) })),
      'index',
    )?.name;
  }

  getNextSequenceNumber(stepName: KycStepName, stepType?: KycStepType): number {
    return Math.max(...this.getStepsWith(stepName, stepType).map((s) => s.sequenceNumber + 1), 0);
  }

  get isDataComplete(): boolean {
    const requiredFields = ['mail', 'phone', 'firstname', 'surname', 'street', 'location', 'zip', 'country'].concat(
      this.accountType === AccountType.PERSONAL
        ? []
        : ['organizationName', 'organizationStreet', 'organizationLocation', 'organizationZip', 'organizationCountry'],
    );
    return requiredFields.filter((f) => !this[f]).length === 0;
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
