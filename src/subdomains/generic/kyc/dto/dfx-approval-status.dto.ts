import { FileSubType } from './kyc-file.dto';

// Internal result of the approval gate: the workflow decides on it and logs it. It is not exposed
// through an endpoint, so it carries no Swagger contract.

export enum DfxApprovalBlocker {
  WRONG_ACCOUNT_TYPE = 'WrongAccountType',
  WRONG_STEP_STATUS = 'WrongStepStatus',
  WRONG_KYC_LEVEL = 'WrongKycLevel',
  MISSING_VERIFIED_NAME = 'MissingVerifiedName',
  MISSING_KYC_HASH = 'MissingKycHash',
  MISSING_FIRST_NAME = 'MissingFirstName',
  MISSING_BIRTHDAY = 'MissingBirthday',
  MISSING_MAIL = 'MissingMail',
  COMPLEX_ORGANIZATION = 'ComplexOrganization',
  RISK_DATA_PENDING = 'RiskDataPending',
  HIGH_RISK = 'HighRisk',
  PEP = 'Pep',
  INVALID_USER_STATUS = 'InvalidUserStatus',
  INVALID_KYC_STATUS = 'InvalidKycStatus',
  MISSING_COUNTRY = 'MissingCountry',
  COUNTRY_DISABLED = 'CountryDisabled',
  COUNTRY_REQUIRES_MANUAL_REVIEW = 'CountryRequiresManualReview',
  COUNTRY_EXCLUDED = 'CountryExcluded',
  MISSING_NATIONALITY = 'MissingNationality',
  NATIONALITY_DISABLED = 'NationalityDisabled',
  MISSING_IDENT_DOCUMENT_TYPE = 'MissingIdentDocumentType',
  IDENT_DOCUMENT_TYPE_DISABLED = 'IdentDocumentTypeDisabled',
  MISSING_IDENT_DOCUMENT_ID = 'MissingIdentDocumentId',
  OPEN_NAME_CHECK = 'OpenNameCheck',
  MISSING_DOCUMENT = 'MissingDocument',
}

export class DfxApprovalBlockerDto {
  code: DfxApprovalBlocker;

  documentSubType?: FileSubType;
}

export class DfxApprovalStatusDto {
  ready: boolean;

  blockers: DfxApprovalBlockerDto[];
}
