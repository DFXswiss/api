import { Config } from 'src/config/config';
import { AccountType } from '../../user/models/user-data/account-type.enum';
import { KycIdentificationType } from '../../user/models/user-data/kyc-identification-type.enum';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { KycLevel, LegalEntity, SignatoryPower } from '../../user/models/user-data/user-data.enum';
import { IdentType } from '../dto/ident-result-data.dto';
import { KycNationalityData } from '../dto/input/kyc-data.dto';
import { SumSubLevelName } from '../dto/sum-sub.dto';
import { KycStepName } from './kyc-step-name.enum';

export function getKycStepIndex(stepName: KycStepName): number {
  return Object.values(KycStepName).indexOf(stepName);
}

export function requiredKycSteps(userData: UserData): KycStepName[] {
  const nationalityStep = userData
    .getStepsWith(KycStepName.NATIONALITY_DATA)
    .find((s) => s.isInReview || s.isCompleted)
    ?.getResult<KycNationalityData>();

  return [
    KycStepName.CONTACT_DATA,
    KycStepName.PERSONAL_DATA,
    KycStepName.NATIONALITY_DATA,
    !userData.wallet.autoTradeApproval && userData.accountType !== AccountType.ORGANIZATION
      ? KycStepName.RECOMMENDATION
      : null,
    nationalityStep?.nationality?.symbol &&
    Config.kyc.residencePermitCountries.includes(nationalityStep.nationality.symbol)
      ? KycStepName.RESIDENCE_PERMIT
      : null,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.LEGAL_ENTITY : null,
    userData.accountType === AccountType.SOLE_PROPRIETORSHIP && userData.kycLevel < KycLevel.LEVEL_50
      ? KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION
      : null,
    userData.accountType === AccountType.ORGANIZATION &&
    !(userData.legalEntity === LegalEntity.GMBH && userData.organizationCountry?.symbol === 'CH')
      ? KycStepName.OWNER_DIRECTORY
      : null,
    userData.accountType === AccountType.ORGANIZATION ? KycStepName.SIGNATORY_POWER : null,
    [SignatoryPower.DOUBLE, SignatoryPower.NONE].includes(userData.signatoryPower) ? KycStepName.AUTHORITY : null,
    userData.accountType === AccountType.ORGANIZATION
      ? [KycStepName.OPERATIONAL_ACTIVITY, KycStepName.BENEFICIAL_OWNER]
      : null,
    userData.recallAgreementAccepted === false ? KycStepName.RECALL_AGREEMENT : null,
    KycStepName.IDENT,
    KycStepName.FINANCIAL_DATA,
    userData.legalEntity === LegalEntity.ASSOCIATION ? KycStepName.STATUTES : null,
    KycStepName.DFX_APPROVAL,
  ]
    .flat()
    .filter(Boolean) as KycStepName[];
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
  RISK_STATUS = 'RiskStatusLog',
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
