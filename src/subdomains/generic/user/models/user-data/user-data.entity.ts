import { NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { KycStep, KycStepResult } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName, KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { User, UserStatus } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankAccount } from 'src/subdomains/supporting/bank/bank-account/bank-account.entity';
import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { UserDataRelation } from '../user-data-relation/user-data-relation.entity';
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

export enum KycLevel {
  // automatic levels
  LEVEL_0 = 0, // nothing
  LEVEL_10 = 10, // contact data
  LEVEL_20 = 20, // personal data

  // verified levels
  LEVEL_30 = 30, // auto ident
  LEVEL_40 = 40, // financial data
  LEVEL_50 = 50, // bank transaction or video ident

  TERMINATED = -10,
  REJECTED = -20,
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
  KYC_ONLY = 'KycOnly',
}

@Entity()
@Index(
  (userData: UserData) => [userData.identDocumentId, userData.nationality, userData.accountType, userData.kycType],
  {
    unique: true,
    where: 'identDocumentId IS NOT NULL AND accountType IS NOT NULL AND kycType IS NOT NULL',
  },
)
export class UserData extends IEntity {
  private readonly logger = new DfxLogger(UserData);

  @Column({ default: AccountType.PERSONAL, length: 256 })
  accountType: AccountType;

  @Column({ length: 256, default: UserDataStatus.NA })
  status: UserDataStatus;

  // --- PERSONAL DATA --- //
  @Column({ length: 256, nullable: true })
  mail: string;

  @Column({ length: 256, nullable: true })
  firstname: string;

  @Column({ length: 256, nullable: true })
  surname: string;

  @Column({ length: 256, nullable: true })
  verifiedName: string;

  @ManyToOne(() => Country, { eager: true, nullable: true })
  verifiedCountry: Country;

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

  @Column({ type: 'float', nullable: true })
  totalVolumeChfAuditPeriod: number;

  @Column({ length: 256, nullable: true })
  allBeneficialOwnersName: string;

  @Column({ length: 256, nullable: true })
  allBeneficialOwnersDomicile: string;

  @Column({ length: 256, nullable: true })
  accountOpenerAuthorization: string;

  @Column({ length: 256, nullable: true })
  phone: string;

  @ManyToOne(() => Language, { eager: true, nullable: false })
  language: Language;

  @ManyToOne(() => Fiat, { eager: true })
  currency: Fiat;

  // --- KYC --- //

  @Column({ length: 256, nullable: true })
  riskState: RiskState;

  @Column({ nullable: true })
  highRisk: boolean;

  @Column({ nullable: true })
  olkypayAllowed: boolean;

  @Column({ nullable: true })
  complexOrgStructure: boolean;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @Column({ type: 'integer', nullable: true })
  kycFileId: number;

  @Column({ default: KycLevel.LEVEL_0 })
  kycLevel: KycLevel;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  kycHash: string;

  @Column({ length: 256, nullable: true })
  kycType: KycType;

  @OneToMany(() => KycStep, (step) => step.userData, { cascade: true })
  kycSteps: KycStep[];

  @Column({ type: 'float', nullable: true })
  depositLimit: number;

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

  @Column({ length: 256, nullable: true })
  identDocumentId: string;

  @Column({ length: 256, nullable: true })
  identDocumentType: string;

  @Column({ length: 256, nullable: true })
  kycClients: string; // semicolon separated wallet id's

  // AML
  @Column({ type: 'datetime2', nullable: true })
  amlListAddedDate: Date;

  @Column({ length: 256, nullable: true })
  internalAmlNote: string;

  @Column({ length: 256, nullable: true })
  amlAccountType: string;

  @Column({ length: 'MAX', nullable: true })
  relatedUsers: string;

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

  // 2FA
  @Column({ nullable: true })
  totpSecret: string;

  // References
  @ManyToOne(() => UserData, { nullable: true })
  @JoinColumn()
  accountOpener: UserData;

  @OneToMany(() => UserDataRelation, (userDataRelation) => userDataRelation.account)
  accountRelations: UserDataRelation[];

  @OneToMany(() => UserDataRelation, (userDataRelation) => userDataRelation.relatedAccount)
  relatedAccountRelations: UserDataRelation[];

  @OneToMany(() => BankAccount, (bankAccount) => bankAccount.userData)
  bankAccounts: BankAccount[];

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToMany(() => User, (user) => user.userData)
  users: User[];

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
      kycLevel: KycLevel.TERMINATED,
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

  addKycClient(walletId: number): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      kycClients: !this.kycClients ? walletId.toString() : `${this.kycClients};${walletId}`,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  removeKycClient(walletId: number): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      kycClients: this.kycClientList.filter((id) => id !== walletId).join(';'),
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

  setVerifiedName(verifiedName: string): UpdateResult<UserData> {
    const update: Partial<UserData> = { verifiedName };

    Object.assign(this, update);

    return [this.id, update];
  }

  get hasValidNameCheckDate(): boolean {
    return this.lastNameCheckDate && Util.daysDiff(this.lastNameCheckDate) <= Config.amlCheckLastNameCheckValidity;
  }

  get kycUrl(): string {
    return `${Config.frontend.services}/kyc?code=${this.kycHash}`;
  }

  get kycVideoUrl(): string {
    return `${this.kycUrl}&step=ident/video`;
  }

  get dilisenseUrl(): string | undefined {
    return this.verifiedName ? `https://dilisense.com/en/search/${encodeURIComponent(this.verifiedName)}` : undefined;
  }

  get isDfxUser(): boolean {
    return this.kycType === KycType.DFX;
  }

  get individualFeeList(): number[] | undefined {
    return this.individualFees?.split(';')?.map(Number);
  }

  get kycClientList(): number[] {
    return this.kycClients?.split(';')?.map(Number) ?? [];
  }

  get hasActiveUser(): boolean {
    return !!this.users.find((e) => e.status === UserStatus.ACTIVE);
  }

  get tradingLimit(): TradingLimit {
    if (this.kycLevel >= KycLevel.LEVEL_50) {
      return {
        limit: this.depositLimit,
        remaining: this.getRemainingYearlyLimit(this.depositLimit),
        period: LimitPeriod.YEAR,
      };
    } else if (this.isKycTerminated) {
      return { limit: 0, period: LimitPeriod.DAY };
    } else {
      return { limit: Config.tradingLimits.dailyDefault, period: LimitPeriod.DAY };
    }
  }

  get availableTradingLimit(): number {
    return this.tradingLimit.period === LimitPeriod.YEAR
      ? this.getRemainingYearlyLimit(this.tradingLimit.limit)
      : this.tradingLimit.limit;
  }

  private getRemainingYearlyLimit(limit: number): number {
    return Math.max(limit - this.annualBuyVolume - this.annualSellVolume - this.annualCryptoVolume, 0);
  }

  get isKycTerminated(): boolean {
    return [KycLevel.REJECTED, KycLevel.TERMINATED].includes(this.kycLevel);
  }

  get kycLevelDisplay(): number {
    return Util.floor(this.kycLevel, -1);
  }

  get completeName(): string {
    return this.organizationName ?? [this.firstname, this.surname].filter((n) => n).join(' ');
  }

  get isBlocked(): boolean {
    return UserDataStatus.BLOCKED === this.status || this.kycLevel < 0;
  }

  // --- KYC PROCESS --- //

  setKycLevel(level: KycLevel): this {
    this.kycLevel = level;

    this.logger.verbose(`User ${this.id} changed to KYC level ${level}`);

    return this;
  }

  completeStep(kycStep: KycStep, result?: KycStepResult): this {
    kycStep.complete(result);
    this.logger.verbose(`User ${this.id} completes step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  failStep(kycStep: KycStep, result?: KycStepResult): this {
    kycStep.fail(result);

    this.logger.verbose(`User ${this.id} fails step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  pauseStep(kycStep: KycStep, result?: KycStepResult): this {
    kycStep.pause(result);
    this.logger.verbose(`User ${this.id} pauses step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  cancelStep(kycStep: KycStep): this {
    kycStep.cancel();
    this.logger.verbose(`User ${this.id} cancels step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  finishStep(kycStep: KycStep): this {
    kycStep.finish();

    this.logger.verbose(`User ${this.id} finishes step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  externalReviewStep(kycStep: KycStep, result?: KycStepResult): this {
    kycStep.externalReview(result);

    this.logger.verbose(`User ${this.id} checks step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  internalReviewStep(kycStep: KycStep, result?: KycStepResult): this {
    kycStep.internalReview(result);

    this.logger.verbose(`User ${this.id} reviews step ${kycStep.name} (${kycStep.id})`);

    return this;
  }

  nextStep(kycStep: KycStep): this {
    this.kycSteps.push(kycStep);

    this.logger.verbose(`User ${this.id} starts step ${kycStep.name}`);

    if (kycStep.isCompleted) this.completeStep(kycStep);
    if (kycStep.isFailed) this.failStep(kycStep);

    return this;
  }

  get hasSuspiciousMail(): boolean {
    return (this.mail?.split('@')[0].match(/\d/g) ?? []).length > 2;
  }

  getStep(stepId: number): KycStep | undefined {
    return this.kycSteps.find((s) => s.id === stepId);
  }

  getStepOrThrow(stepId: number): KycStep {
    const kycStep = this.getStep(stepId);
    if (!kycStep) throw new NotFoundException('KYC step not found');

    return kycStep;
  }

  getStepsWith(name?: KycStepName, type?: KycStepType, sequenceNumber?: number): KycStep[] {
    return this.kycSteps.filter(
      (s) =>
        (!name || s.name === name) &&
        (!type || s.type === type) &&
        (!sequenceNumber || s.sequenceNumber === sequenceNumber),
    );
  }

  getPendingStepWith(name?: KycStepName, type?: KycStepType, sequenceNumber?: number): KycStep | undefined {
    return this.getStepsWith(name, type, sequenceNumber).find((s) => s.isInProgress);
  }

  getPendingStepOrThrow(stepId: number): KycStep {
    const kycStep = this.getStep(stepId);
    if (!kycStep?.isInProgress) throw new NotFoundException('KYC step not found');

    return kycStep;
  }

  get hasStepsInProgress(): boolean {
    return this.kycSteps.some((s) => s.isInProgress);
  }

  getNextSequenceNumber(stepName: KycStepName, stepType?: KycStepType): number {
    return Math.max(...this.getStepsWith(stepName, stepType).map((s) => s.sequenceNumber + 1), 0);
  }

  hasCompletedStep(stepName: KycStepName): boolean {
    return this.getStepsWith(stepName).some((s) => s.isCompleted);
  }

  hasDoneStep(stepName: KycStepName): boolean {
    return this.getStepsWith(stepName).some((s) => s.isDone);
  }

  get requiredKycFields(): string[] {
    return ['accountType', 'mail', 'phone', 'firstname', 'surname', 'street', 'location', 'zip', 'country'].concat(
      this.accountType === AccountType.PERSONAL
        ? []
        : ['organizationName', 'organizationStreet', 'organizationLocation', 'organizationZip', 'organizationCountry'],
    );
  }

  get isDataComplete(): boolean {
    return this.requiredKycFields.every((f) => this[f]);
  }

  get hasBankTxVerification(): boolean {
    return [CheckStatus.PASS, CheckStatus.UNNECESSARY, CheckStatus.GSHEET].includes(this.bankTransactionVerification);
  }

  get isPaymentStatusEnabled(): boolean {
    return [UserDataStatus.ACTIVE, UserDataStatus.NA].includes(this.status);
  }

  get isPaymentKycStatusEnabled(): boolean {
    return [KycStatus.COMPLETED, KycStatus.NA].includes(this.kycStatus);
  }
}

export const KycCompletedStates = [KycStatus.COMPLETED];

export function KycCompleted(kycStatus?: KycStatus): boolean {
  return KycCompletedStates.includes(kycStatus);
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
