import { KycStepReason } from './output/kyc-info.dto';

export enum KycIdentError {
  USER_DATA_MERGED = 'UserDataMerged',
  USER_DATA_MERGE_REQUESTED = 'UserDataMergeRequested',
  USER_DATA_EXISTING = 'UserDataExisting',
  USER_DATA_BLOCKED = 'UserDataBlocked',
  FIRST_NAME_NOT_MATCHING = 'FirstNameNotMatching',
  LAST_NAME_NOT_MATCHING = 'LastNameNotMatching',
  REVERSED_NAMES = 'ReversedNames',
  NATIONALITY_NOT_MATCHING = 'NationalityNotMatching',
  NATIONALITY_MISSING = 'NationalityMissing',
  NATIONALITY_NOT_ALLOWED = 'NationalityNotAllowed',
  INVALID_DOCUMENT_TYPE = 'InvalidDocumentType',
  IDENTIFICATION_NUMBER_MISSING = 'IdentificationNumberMissing',
  INVALID_RESULT = 'InvalidResult',
  VERIFIED_NAME_MISSING = 'VerifiedNameMissing',
  FIRST_NAME_NOT_MATCHING_VERIFIED_NAME = 'FirstNameNotMatchingVerifiedName',
  LAST_NAME_NOT_MATCHING_VERIFIED_NAME = 'LastNameNotMatchingVerifiedName',
  ORGANIZATION_NAME_NOT_MATCHING_VERIFIED_NAME = 'OrganizationNameNotMatchingVerifiedName',
  COUNTRY_NOT_ALLOWED = 'CountryNotAllowed',
  BLOCKED = 'Blocked',
  RELEASED = 'Released',
}

export enum KycFinancialDataError {
  MISSING_QUESTION = 'MissingQuestion',
  RISKY_BUSINESS = 'RiskyBusiness',
}

export const KycIdentErrorMap: Record<KycIdentError, string> = {
  [KycIdentError.USER_DATA_MERGED]: 'Your account is merged',
  [KycIdentError.USER_DATA_MERGE_REQUESTED]: 'Merge request mail sent to your existing account',
  [KycIdentError.USER_DATA_EXISTING]: 'You already completed KYC with another account',
  [KycIdentError.USER_DATA_BLOCKED]: 'Unknown error',
  [KycIdentError.FIRST_NAME_NOT_MATCHING]: 'Your first name is not matching',
  [KycIdentError.LAST_NAME_NOT_MATCHING]: 'Your last name is not matching',
  [KycIdentError.NATIONALITY_NOT_MATCHING]: 'Your nationality is not matching',
  [KycIdentError.NATIONALITY_MISSING]: 'Nationality is missing',
  [KycIdentError.NATIONALITY_NOT_ALLOWED]: 'Nationality is not allowed',
  [KycIdentError.INVALID_DOCUMENT_TYPE]: 'Your document type is invalid',
  [KycIdentError.IDENTIFICATION_NUMBER_MISSING]: 'Your identification number is missing',
  [KycIdentError.INVALID_RESULT]: 'Unknown error',
  [KycIdentError.VERIFIED_NAME_MISSING]: 'Account name is missing',
  [KycIdentError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your first name does not match your account name',
  [KycIdentError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your last name does not match your account name',
  [KycIdentError.ORGANIZATION_NAME_NOT_MATCHING_VERIFIED_NAME]:
    'Your organization name does not match your account name',
  [KycIdentError.COUNTRY_NOT_ALLOWED]: 'Your country is not allowed for KYC',
  [KycIdentError.REVERSED_NAMES]: 'The names in your account are reversed',
  [KycIdentError.BLOCKED]: 'KYC is blocked',
  [KycIdentError.RELEASED]: undefined,
};

export const KycReasonMap: { [e in KycIdentError]?: KycStepReason } = {
  [KycIdentError.USER_DATA_EXISTING]: KycStepReason.ACCOUNT_EXISTS,
  [KycIdentError.USER_DATA_MERGE_REQUESTED]: KycStepReason.ACCOUNT_MERGE_REQUESTED,
};
