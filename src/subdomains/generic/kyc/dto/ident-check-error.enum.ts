export enum IdentCheckError {
  USER_DATA_MERGED = 'UserDataMerged',
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

export const IdentCheckErrorMap: Record<IdentCheckError, string> = {
  [IdentCheckError.USER_DATA_MERGED]: 'Your account is merged',
  [IdentCheckError.USER_DATA_BLOCKED]: 'Unknown error',
  [IdentCheckError.FIRST_NAME_NOT_MATCHING]: 'Your first name is not matching',
  [IdentCheckError.LAST_NAME_NOT_MATCHING]: 'Your last name is not matching',
  [IdentCheckError.NATIONALITY_NOT_MATCHING]: 'Your nationality is not matching',
  [IdentCheckError.NATIONALITY_MISSING]: 'Nationality is missing',
  [IdentCheckError.INVALID_DOCUMENT_TYPE]: 'Your document type is invalid',
  [IdentCheckError.IDENTIFICATION_NUMBER_MISSING]: 'Your identification number is missing',
  [IdentCheckError.INVALID_RESULT]: 'Unknown error',
  [IdentCheckError.VERIFIED_NAME_MISSING]: 'Account name is missing',
  [IdentCheckError.FIRST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your first name does not match your account name',
  [IdentCheckError.LAST_NAME_NOT_MATCHING_VERIFIED_NAME]: 'Your last name does not match your account name',
  [IdentCheckError.ORGANIZATION_NAME_NOT_MATCHING_VERIFIED_NAME]:
    'Your organization name does not match your account name',
};
