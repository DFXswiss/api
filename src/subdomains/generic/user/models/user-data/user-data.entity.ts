import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Country } from 'src/shared/models/country/country.entity';
import { IEntity, UpdateResult } from 'src/shared/models/entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { Util } from 'src/shared/utils/util';
import { AmlListStatus } from 'src/subdomains/core/aml/enums/aml-list-status.enum';
import { CheckStatus } from 'src/subdomains/core/aml/enums/check-status.enum';
import { DefaultPaymentLinkConfig, PaymentLinkConfig } from 'src/subdomains/core/payment-link/entities/payment-link.config';
import { KycFile } from 'src/subdomains/generic/kyc/entities/kyc-file.entity';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycStepType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SupportIssue } from 'src/subdomains/supporting/support-issue/entities/support-issue.entity';
import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AccountOpenerAuthorization, Organization } from '../organization/organization.entity';
import { UserDataRelation } from '../user-data-relation/user-data-relation.entity';
import { UpdateUserDto } from '../user/dto/update-user.dto';
import { TradingLimit } from '../user/dto/user.dto';
import { UserStatus } from '../user/user.enum';
import { Wallet } from '../wallet/wallet.entity';
import { AccountType } from './account-type.enum';
import { KycIdentificationType } from './kyc-identification-type.enum';
import {
  BlankType,
  KycLevel,
  KycStatus,
  KycType,
  LegalEntity,
  LimitPeriod,
  Moderator,
  RiskStatus,
  SignatoryPower,
  UserDataStatus,
} from './user-data.enum';

@Entity()
@Index(
  (userData: UserData) => [userData.identDocumentId, userData.nationality, userData.accountType, userData.kycType],
  {
    unique: true,
    where: 'identDocumentId IS NOT NULL AND accountType IS NOT NULL AND kycType IS NOT NULL',
  },
)
export class UserData extends IEntity {
  @Column({ nullable: true, length: 256 })
  accountType?: AccountType;

  @Column({ length: 256, default: UserDataStatus.NA })
  status: UserDataStatus;

  @Column({ length: 256, default: RiskStatus.NA })
  riskStatus: RiskStatus;

  @Column({ length: 256, nullable: true })
  moderator: Moderator;

  @Column({ type: 'datetime2', nullable: true })
  deactivationDate?: Date;

  // --- PERSONAL DATA --- //
  @Column({ length: 256, nullable: true })
  mail?: string;

  @Column({ length: 256, nullable: true })
  firstname?: string;

  @Column({ length: 256, nullable: true })
  surname?: string;

  @Column({ length: 256, nullable: true })
  verifiedName?: string;

  @ManyToOne(() => Country, { eager: true, nullable: true })
  verifiedCountry?: Country;

  @Column({ length: 256, nullable: true })
  street?: string;

  @Column({ length: 256, nullable: true })
  houseNumber?: string;

  @Column({ length: 256, nullable: true })
  location?: string;

  @Column({ length: 256, nullable: true })
  zip?: string;

  @ManyToOne(() => Country, { eager: true })
  country: Country;

  @ManyToOne(() => Country, { eager: true, nullable: true })
  nationality?: Country;

  @Column({ type: 'datetime2', nullable: true })
  birthday?: Date;

  // --- ORGANIZATION DATA --- //
  // TODO remove after sync
  @Column({ length: 256, nullable: true })
  organizationName?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  organizationStreet?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  organizationHouseNumber?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  organizationLocation?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  organizationZip?: string;

  // TODO remove
  @ManyToOne(() => Country, { eager: true })
  organizationCountry: Country;

  @Column({ type: 'float', nullable: true })
  totalVolumeChfAuditPeriod?: number;

  // TODO remove
  @Column({ length: 256, nullable: true })
  allBeneficialOwnersName?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  allBeneficialOwnersDomicile?: string;

  // TODO remove
  @Column({ length: 256, nullable: true })
  accountOpenerAuthorization?: AccountOpenerAuthorization;

  @Column({ length: 256, nullable: true })
  phone?: string;

  @ManyToOne(() => Language, { eager: true, nullable: false })
  language: Language;

  @ManyToOne(() => Fiat, { eager: true })
  currency: Fiat;

  // --- KYC --- //

  // TODO remove
  @Column({ length: 256, nullable: true })
  legalEntity?: LegalEntity;

  // TODO remove
  @Column({ length: 256, nullable: true })
  signatoryPower?: SignatoryPower;

  @Column({ nullable: true })
  highRisk?: boolean;

  @Column({ nullable: true })
  olkypayAllowed?: boolean;

  @Column({ nullable: true })
  recallAgreementAccepted?: boolean; // null = deactivated, false = step activated, true = step completed by user

  // TODO remove
  @Column({ nullable: true })
  complexOrgStructure?: boolean;

  @Column({ length: 256, default: KycStatus.NA })
  kycStatus: KycStatus;

  @OneToMany(() => KycFile, (kycFile) => kycFile.userData)
  kycFiles: KycFile[];

  @Column({ type: 'integer', nullable: true })
  kycFileId?: number;

  @Column({ default: KycLevel.LEVEL_0 })
  kycLevel: KycLevel;

  @Column()
  @Generated('uuid')
  @Index({ unique: true })
  kycHash: string;

  @Column({ length: 256, nullable: true })
  kycType?: KycType;

  @OneToMany(() => KycStep, (step) => step.userData)
  kycSteps: KycStep[];

  @Column({ type: 'float', nullable: true })
  depositLimit?: number;

  @Column({ type: 'datetime2', nullable: true })
  letterSentDate?: Date;

  @Column({ length: 256, nullable: true })
  identificationType?: KycIdentificationType;

  @Column({ nullable: true })
  pep?: boolean;

  @Column({ length: 256, nullable: true })
  bankTransactionVerification?: CheckStatus;

  @Column({ type: 'datetime2', nullable: true })
  lastNameCheckDate?: Date;

  @Column({ length: 256, nullable: true })
  identDocumentId?: string;

  @Column({ length: 256, nullable: true })
  identDocumentType?: string;

  @Column({ length: 256, nullable: true })
  kycClients?: string; // semicolon separated wallet id's

  @Column({ type: 'datetime2', nullable: true })
  phoneCallCheckDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  phoneCallIpCheckDate?: Date;

  // AML
  @Column({ type: 'datetime2', nullable: true })
  amlListAddedDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  amlListExpiredDate?: Date;

  @Column({ type: 'datetime2', nullable: true })
  amlListReactivatedDate?: Date;

  @Column({ length: 256, nullable: true })
  amlListStatus?: AmlListStatus;

  @Column({ length: 256, nullable: true })
  internalAmlNote?: string;

  @Column({ length: 256, nullable: true })
  amlAccountType?: string;

  @Column({ length: 'MAX', nullable: true })
  relatedUsers?: string;

  @Column({ length: 256, nullable: true })
  postAmlCheck?: string;

  @Column({ nullable: true })
  hasBankTx?: boolean;

  @Column({ nullable: true })
  hasIpRisk?: boolean;

  // Mail
  @Column({ length: 256, nullable: true })
  blackSquadRecipientMail?: string;

  @Column({ type: 'datetime2', nullable: true })
  blackSquadMailSendDate?: Date;

  // Fee / Discounts
  @Column({ length: 256, nullable: true })
  individualFees?: string; // semicolon separated id's

  // CT
  @Column({ length: 256, nullable: true })
  @Index({ unique: true, where: 'apiKeyCT IS NOT NULL' })
  apiKeyCT?: string;

  @Column({ length: 256, nullable: true })
  apiFilterCT?: string;

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
  totpSecret?: string;

  // Point of Sale
  @Column({ default: false })
  paymentLinksAllowed: boolean;

  @Column({ length: 256, nullable: true })
  paymentLinksName?: string;

  @Column({ length: 'MAX', nullable: true })
  paymentLinksConfig?: string; // PaymentLinkConfig

  // References
  @ManyToOne(() => Wallet, { nullable: true })
  wallet: Wallet;

  @OneToMany(() => Transaction, (tx) => tx.userData)
  transactions: Transaction[];

  // TODO remove
  @ManyToOne(() => UserData, { nullable: true })
  @JoinColumn()
  accountOpener?: UserData;

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  organization: Organization;

  @OneToMany(() => UserDataRelation, (userDataRelation) => userDataRelation.account)
  accountRelations: UserDataRelation[];

  @OneToMany(() => UserDataRelation, (userDataRelation) => userDataRelation.relatedAccount)
  relatedAccountRelations: UserDataRelation[];

  @OneToMany(() => BankData, (bankData) => bankData.userData)
  bankDatas: BankData[];

  @OneToMany(() => BankTxReturn, (bankTxReturn) => bankTxReturn.userData)
  bankTxReturns: BankTxReturn[];

  @OneToMany(() => SupportIssue, (supportIssue) => supportIssue.userData)
  supportIssues: SupportIssue[];

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

  setAccountOpenerAuthorization(signatoryPower: SignatoryPower): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      accountOpenerAuthorization:
        signatoryPower === SignatoryPower.SINGLE
          ? AccountOpenerAuthorization.SINGLE_SIGNATURE
          : AccountOpenerAuthorization.AUTHORIZATION,
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  deactivateUserData(): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      status: UserDataStatus.DEACTIVATED,
      kycLevel: Math.min(this.kycLevel, KycLevel.LEVEL_20),
      deactivationDate: new Date(),
    };

    Object.assign(this, update);

    return [this.id, update];
  }

  reactivateUserData(): Partial<UserData> {
    return {
      status:
        this.users.length === 0
          ? UserDataStatus.KYC_ONLY
          : this.users.some((u) => u.status === UserStatus.ACTIVE)
          ? UserDataStatus.ACTIVE
          : UserDataStatus.NA,
      deactivationDate: null,
    };
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

  setUserDataSettings(dto: UpdateUserDto): UpdateResult<UserData> {
    const update: Partial<UserData> = {
      phone: dto.phone ?? this.phone,
      language: dto.language ?? this.language,
      currency: dto.currency ?? this.currency,
    };

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
      return { limit: 0, period: LimitPeriod.MONTH };
    } else {
      return { limit: Config.tradingLimits.monthlyDefaultWoKyc, period: LimitPeriod.MONTH };
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
    return this.organizationName ?? this.naturalPersonName;
  }

  get naturalPersonName(): string {
    return [this.firstname, this.surname].filter((n) => n).join(' ');
  }

  get isBlocked(): boolean {
    return UserDataStatus.BLOCKED === this.status || this.kycLevel < 0;
  }

  get isDeactivated(): boolean {
    return this.status === UserDataStatus.DEACTIVATED;
  }

  get isRisky(): boolean {
    return this.riskStatus === RiskStatus.BLOCKED;
  }

  get isSuspicious(): boolean {
    return this.riskStatus === RiskStatus.SUSPICIOUS;
  }

  get isBlockedOrDeactivated(): boolean {
    return this.isBlocked || this.isDeactivated;
  }

  get address() {
    return [AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP].includes(this.accountType)
      ? {
          street: this.organizationStreet,
          houseNumber: this.organizationHouseNumber,
          city: this.organizationLocation,
          zip: this.organizationZip,
          country: this.organizationCountry,
        }
      : {
          street: this.street,
          houseNumber: this.houseNumber,
          city: this.location,
          zip: this.zip,
          country: this.country,
        };
  }

  get paymentLinksConfigObj(): PaymentLinkConfig {
    return Object.assign({}, DefaultPaymentLinkConfig, JSON.parse(this.paymentLinksConfig ?? '{}'));
  }

  // --- KYC PROCESS --- //

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

  getCompletedStepWith(name?: KycStepName, type?: KycStepType, sequenceNumber?: number): KycStep | undefined {
    return this.getStepsWith(name, type, sequenceNumber).find((s) => s.isCompleted);
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
    const existingSteps = [
      this.getStepsWith(stepName, stepType),
      this.getStepsWith(stepName, this.getDeprecatedStepTypes(stepType)),
    ].flat();
    return Math.max(...existingSteps.map((s) => s.sequenceNumber + 1), 0);
  }

  getDeprecatedStepTypes(type?: KycStepType): KycStepType {
    switch (type) {
      case KycStepType.SUMSUB_AUTO:
        return KycStepType.AUTO;

      case KycStepType.SUMSUB_VIDEO:
        return KycStepType.VIDEO;
    }
  }

  hasCompletedStep(stepName: KycStepName): boolean {
    return this.getStepsWith(stepName).some((s) => s.isCompleted);
  }

  hasDoneStep(stepName: KycStepName): boolean {
    return this.getStepsWith(stepName).some((s) => s.isDone);
  }

  checkIfMergePossibleWith(slave: UserData): void {
    if (!this.isDfxUser) throw new BadRequestException(`Invalid KYC type`);

    if (slave.amlListAddedDate && this.amlListAddedDate)
      throw new BadRequestException('Slave and master are on AML list');

    if ([this.status, slave.status].includes(UserDataStatus.MERGED))
      throw new BadRequestException('Master or slave is already merged');

    if (this.verifiedName && slave.verifiedName && !Util.isSameName(this.verifiedName, slave.verifiedName))
      throw new BadRequestException('Verified name mismatch');

    if (this.isBlocked || slave.isBlocked) throw new BadRequestException('Master or slave is blocked');

    if (slave.kycLevel >= KycLevel.LEVEL_20 && this.accountType !== slave.accountType)
      throw new BadRequestException('Account type mismatch');
  }

  isMergePossibleWith(slave: UserData): boolean {
    try {
      this.checkIfMergePossibleWith(slave);
      return true;
    } catch {
      return false;
    }
  }

  get requiredKycFields(): string[] {
    return ['accountType', 'mail', 'phone', 'firstname', 'surname', 'street', 'location', 'zip', 'country'].concat(
      !this.accountType || this.accountType === AccountType.PERSONAL
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

export const UserDataSupportUpdateCols = ['status', 'riskStatus', 'recallAgreementAccepted'];
export const UserDataComplianceUpdateCols = ['kycStatus', 'depositLimit'];

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
