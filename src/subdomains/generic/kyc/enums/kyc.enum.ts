import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycIdentificationType, UserData } from '../../user/models/user-data/user-data.entity';

export enum KycStepName {
  CONTACT_DATA = 'ContactData',
  PERSONAL_DATA = 'PersonalData',
  NATIONALITY_DATA = 'NationalityData',
  COMMERCIAL_REGISTER = 'CommercialRegister',
  IDENT = 'Ident',
  FINANCIAL_DATA = 'FinancialData',
  DOCUMENT_UPLOAD = 'DocumentUpload',
  DFX_APPROVAL = 'DfxApproval',
}

export function getKycStepIndex(stepName: KycStepName): number {
  return Object.values(KycStepName).indexOf(stepName);
}

export function requiredKycSteps(userData: UserData): KycStepName[] {
  return userData.accountType === AccountType.BUSINESS
    ? [
        KycStepName.CONTACT_DATA,
        KycStepName.PERSONAL_DATA,
        KycStepName.NATIONALITY_DATA,
        KycStepName.COMMERCIAL_REGISTER,
        KycStepName.IDENT,
        KycStepName.FINANCIAL_DATA,
        KycStepName.DFX_APPROVAL,
      ]
    : [
        KycStepName.CONTACT_DATA,
        KycStepName.PERSONAL_DATA,
        KycStepName.NATIONALITY_DATA,
        KycStepName.IDENT,
        KycStepName.FINANCIAL_DATA,
        KycStepName.DFX_APPROVAL,
      ];
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
  NONE = undefined,
}

export enum QuestionType {
  CONFIRMATION = 'Confirmation',
  SINGLE_CHOICE = 'SingleChoice',
  MULTIPLE_CHOICE = 'MultipleChoice',
  TEXT = 'Text',
}
