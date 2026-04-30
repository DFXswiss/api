export enum IdentType {
  SUM_SUB = 'Sumsub',
  ID_NOW = 'IdNow',
  MANUAL = 'Manual',
}

export enum IdentDocumentType {
  IDCARD = 'IDCARD',
  PASSPORT = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  DRIVERS_TRANSLATION = 'DRIVERS_TRANSLATION',
  RESIDENCE_PERMIT = 'RESIDENCE_PERMIT',
}

export const ValidDocType = [IdentDocumentType.IDCARD, IdentDocumentType.PASSPORT];
export const NationalityDocType = [IdentDocumentType.IDCARD, IdentDocumentType.PASSPORT];

export interface IdentResultData {
  type: IdentType;
  firstname: string;
  lastname: string;
  birthname: string;
  documentType: IdentDocumentType;
  documentNumber: string;
  kycType: string;
  birthday: Date;
  nationality: string;
  success: boolean;
  ipCountry: string;
  country: string;
}
