import { KycStepReason } from './output/kyc-info.dto';

export enum KycError {
  USER_DATA_MERGED = 'UserDataMerged',
  USER_DATA_MERGE_REQUESTED = 'UserDataMergeRequested',
  USER_DATA_EXISTING = 'UserDataExisting',
  USER_DATA_BLOCKED = 'UserDataBlocked',
  FIRST_NAME_NOT_MATCHING = 'FirstNameNotMatching',
  LAST_NAME_NOT_MATCHING = 'LastNameNotMatching',
  NATIONALITY_NOT_MATCHING = 'NationalityNotMatching',
  NATIONALITY_MISSING = 'NationalityMissing',
  INVALID_DOCUMENT_TYPE = 'InvalidDocumentType',
  IDENTIFICATION_NUMBER_MISSING = 'IdentificationNumberMissing',
  INVALID_RESULT = 'InvalidResult',
  VERIFIED_NAME_MISSING = 'VerifiedNameMissing',
  FIRST_NAME_NOT_MATCHING_VERIFIED_NAME = 'FirstNameNotMatchingVerifiedName',
  LAST_NAME_NOT_MATCHING_VERIFIED_NAME = 'LastNameNotMatchingVerifiedName',
  ORGANIZATION_NAME_NOT_MATCHING_VERIFIED_NAME = 'OrganizationNameNotMatchingVerifiedName',
}

export const KycErrorMap: Record<KycError, string> = {
  [KycError.USER_DATA_MERGED]: 'Your account is merged',
  [KycError.USER_DATA_MERGE_REQUESTED]: 'Merge request mail sent to your existing account',
  [KycError.USER_DATA_EXISTING]: 'You already completed KYC with another account',
  [KycError.USER_DATA_BLOCKED]: 'Unknown error',
  [KycError.FIRST_NAME_NOT_MATCHING]: 'Your first name is not matching',
  [KycError.LAST_NAME_NOT_MATCHING]: 'Your last name is not matching',
  [KycError.NATIONALITY_NOT_MATCHING]: 'Your nationality is not matching',
  [KycError.NATIONALITY_MISSING]: 'Nationality is missing',
  [KycError.INVALID_DOCUMENT_TYPE]: 'Your document type is invalid',
  [KycError.IDENTIFICATION_NUMBER_MISSING]: 'Your identification number is missing',
  [KycError.INVALID_RESULT]: 'Unknown error',
  [KycError.VERIFIED_NAME_MISSING]: 'Account name is missing',
  [KycError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your first name does not match your account name',
  [KycError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your last name does not match your account name',
  [KycError.ORGANIZATION_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your organization name does not match your account name',
};

export const KycReasonMap: { [e in KycError]?: KycStepReason } = {
  [KycError.USER_DATA_EXISTING]: KycStepReason.ACCOUNT_EXISTS,
  [KycError.USER_DATA_MERGE_REQUESTED]: KycStepReason.ACCOUNT_MERGE_REQUESTED,
};
