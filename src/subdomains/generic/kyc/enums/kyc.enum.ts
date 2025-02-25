import { Config } from 'src/config/config';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { LegalEntity, SignatoryPower, UserData } from '../../user/models/user-data/user-data.entity';
import { IdentType } from '../dto/ident-result-data.dto';
import { SumSubLevelName } from '../dto/sum-sub.dto';
import { KycStepName } from './kyc-step-name.enum';

export function getKycStepIndex(stepName: KycStepName): number {
  return Object.values(KycStepName).indexOf(stepName);
}

export function requiredKycSteps(userData: UserData): KycStepName[] {
  return [
    KycStepName.CONTACT_DATA,
    KycStepName.PERSONAL_DATA,
    KycStepName.NATIONALITY_DATA,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.LEGAL_ENTITY : null,
    userData.accountType === AccountType.ORGANIZATION &&
    (userData.legalEntity !== LegalEntity.LIMITED_LIABILITY_COMPANY ||
      !userData.organizationCountry ||
      userData.organizationCountry.symbol !== 'CH')
      ? KycStepName.OWNER_DIRECTORY
      : null,
    [AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP].includes(userData.accountType)
      ? KycStepName.COMMERCIAL_REGISTER
      : null,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.SIGNATORY_POWER : null,
    [SignatoryPower.DOUBLE, SignatoryPower.NONE].includes(userData.signatoryPower) ? KycStepName.AUTHORITY : null,
    KycStepName.IDENT,
    KycStepName.FINANCIAL_DATA,
    Config.kyc.residencePermitCountries.includes(userData.nationality?.symbol) ? KycStepName.RESIDENCE_PERMIT : null,
    KycStepName.DFX_APPROVAL,
  ].filter(Boolean) as KycStepName[];
}

export enum KycStepType {
  // ident
  AUTO = 'Auto',
  VIDEO = 'Video',
  MANUAL = 'Manual',
  SUMSUB_AUTO = 'SumsubAuto',
  SUMSUB_VIDEO = 'SumsubVideo',
}

export enum KycLogType {
  KYC = 'KycLog',
  STEP = 'StepLog',
  NAME_CHECK = 'NameCheckLog',
  MERGE = 'MergeLog',
  MAIL_CHANGE = 'MailChangeLog',
  TFA = 'TfaLog',
  FILE = 'KycFileLog',
  MANUAL = 'ManualLog',
}

export function getKycTypeIndex(stepType?: KycStepType): number {
  return Object.values(KycStepType).indexOf(stepType);
}

export function getIdentificationType(type: IdentType, companyId: string): KycIdentificationType | undefined {
  if (!companyId) return undefined;
  if (type === IdentType.SUM_SUB)
    return companyId === SumSubLevelName.CH_STANDARD_VIDEO
      ? KycIdentificationType.VIDEO_ID
      : KycIdentificationType.ONLINE_ID;

  if (type === IdentType.MANUAL) return KycIdentificationType.MANUAL;

  switch (companyId) {
    case 'dfxautonew':
    case 'dfxauto':
    case 'kycspiderauto':
      return KycIdentificationType.ONLINE_ID;

    case 'dfxvidnew':
    case 'dfxvideo':
    case 'kycspider':
      return KycIdentificationType.VIDEO_ID;

    default:
      return undefined;
  }
}

export enum KycStepStatus {
  NOT_STARTED = 'NotStarted',
  IN_PROGRESS = 'InProgress',
  FINISHED = 'Finished',
  EXTERNAL_REVIEW = 'ExternalReview',
  INTERNAL_REVIEW = 'InternalReview',
  MANUAL_REVIEW = 'ManualReview',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
  PARTIALLY_APPROVED = 'PartiallyApproved',
  CANCELED = 'Canceled',
  IGNORED = 'Ignored',
  OUTDATED = 'Outdated',
  DATA_REQUESTED = 'DataRequested',
  PAUSED = 'Paused',
}

export enum UrlType {
  BROWSER = 'Browser',
  API = 'API',
  TOKEN = 'Token',
  NONE = 'None',
}

export enum QuestionType {
  CONFIRMATION = 'Confirmation',
  SINGLE_CHOICE = 'SingleChoice',
  MULTIPLE_CHOICE = 'MultipleChoice',
  TEXT = 'Text',
}
