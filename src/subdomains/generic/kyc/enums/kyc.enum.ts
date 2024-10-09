import { AccountType } from '../../user/models/user-data/account-type.enum';
import {
  KycIdentificationType,
  LegalEntity,
  SignatoryPower,
  UserData,
} from '../../user/models/user-data/user-data.entity';
import { IdentType } from '../dto/ident-result-data.dto';
import { SumSubWebhookType } from '../dto/sum-sub.dto';

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
  ADDITIONAL_DOCUMENTS = 'AdditionalDocuments',
  RESIDENCE_PERMIT = 'ResidencePermit',
  DFX_APPROVAL = 'DfxApproval',
}

export function getKycStepIndex(stepName: KycStepName): number {
  return Object.values(KycStepName).indexOf(stepName);
}

export function requiredKycSteps(userData: UserData): KycStepName[] {
  return [
    KycStepName.CONTACT_DATA,
    KycStepName.PERSONAL_DATA,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.LEGAL_ENTITY : null,
    userData.legalEntity === LegalEntity.PUBLIC_LIMITED_COMPANY ? KycStepName.STOCK_REGISTER : null,
    KycStepName.NATIONALITY_DATA,
    [AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP].includes(userData.accountType)
      ? KycStepName.COMMERCIAL_REGISTER
      : null,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.SIGNATORY_POWER : null,
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
  SUMSUB_AUTO = 'SumsubAuto',
}

export enum KycLogType {
  KYC_STEP = 'KycStep',
  NAME_CHECK = 'NameCheck',
  MERGE = 'Merge',
  MAIL_CHANGE = 'MailChange',
  TFA = '2FA',
}

export function getKycTypeIndex(stepType?: KycStepType): number {
  return Object.values(KycStepType).indexOf(stepType);
}

export function getIdentificationType(type: IdentType, companyId: string): KycIdentificationType | undefined {
  if (!companyId) return undefined;
  if (type === IdentType.SUM_SUB)
    return companyId === SumSubWebhookType.VIDEO_IDENT_STATUS_CHANGED
      ? KycIdentificationType.VIDEO_ID
      : KycIdentificationType.ONLINE_ID;

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
  TOKEN = 'Token',
  NONE = 'None',
}

export enum QuestionType {
  CONFIRMATION = 'Confirmation',
  SINGLE_CHOICE = 'SingleChoice',
  MULTIPLE_CHOICE = 'MultipleChoice',
  TEXT = 'Text',
}
