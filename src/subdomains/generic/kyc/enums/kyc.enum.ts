import { AccountType } from '../../user/models/user-data/account-type.enum';
import {
  KycIdentificationType,
  LegalEntity,
  SignatoryPower,
  UserData,
} from '../../user/models/user-data/user-data.entity';

export enum KycStepName {
  CONTACT_DATA = 'ContactData',
  PERSONAL_DATA = 'PersonalData',
  LEGAL_ENTITY = 'LegalEntity',
  STOCK_REGISTER = 'StockRegister',
  NATIONALITY_DATA = 'NationalityData',
  COMMERCIAL_REGISTER = 'CommercialRegister',
  SIGNATORY_POWER = 'SignatoryPower',
  AUTHORITY = 'Authority',
  IDENT = 'Ident',
  FINANCIAL_DATA = 'FinancialData',
  DOCUMENT_UPLOAD = 'DocumentUpload',
  DFX_APPROVAL = 'DfxApproval',
}

export function getKycStepIndex(stepName: KycStepName): number {
  return Object.values(KycStepName).indexOf(stepName);
}

export function requiredKycSteps(userData: UserData): KycStepName[] {
  return [
    KycStepName.CONTACT_DATA,
    KycStepName.PERSONAL_DATA,
    userData.accountType === AccountType.BUSINESS ? KycStepName.LEGAL_ENTITY : null,
    userData.legalEntity === LegalEntity.PUBLIC_LIMITED_COMPANY ? KycStepName.STOCK_REGISTER : null,
    KycStepName.NATIONALITY_DATA,
    [AccountType.BUSINESS, AccountType.SOLE_PROPRIETORSHIP].includes(userData.accountType)
      ? KycStepName.COMMERCIAL_REGISTER
      : null,
    userData.accountType === AccountType.BUSINESS ? KycStepName.SIGNATORY_POWER : null,
    [SignatoryPower.DOUBLE, SignatoryPower.NONE].includes(userData.signatoryPower) ? KycStepName.AUTHORITY : null,
    KycStepName.IDENT,
    KycStepName.FINANCIAL_DATA,
    KycStepName.DFX_APPROVAL,
  ].filter(Boolean) as KycStepName[];
}

export enum KycStepType {
  // ident
  AUTO = 'Auto',
  VIDEO = 'Video',
  MANUAL = 'Manual',
  // document
  // TODO
}

export enum KycLogType {
  KYC_STEP = 'KycStep',
  NAME_CHECK = 'NameCheck',
  MERGE = 'Merge',
  TFA = '2FA',
}

export function getKycTypeIndex(stepType?: KycStepType): number {
  return Object.values(KycStepType).indexOf(stepType);
}

export function getIdentificationType(companyId: string): KycIdentificationType | undefined {
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
  CANCELED = 'Canceled',
  IGNORED = 'Ignored',
  OUTDATED = 'Outdated',
}

export enum UrlType {
  BROWSER = 'Browser',
  API = 'API',
  NONE = 'None',
}

export enum QuestionType {
  CONFIRMATION = 'Confirmation',
  SINGLE_CHOICE = 'SingleChoice',
  MULTIPLE_CHOICE = 'MultipleChoice',
  TEXT = 'Text',
}
