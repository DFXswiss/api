export enum IdentType {
  SUM_SUB = 'Sumsub',
  ID_NOW = 'IdNow',
  MANUAL = 'Manual',
}

export enum IdentDocumentType {
  IDCARD = 'IDCARD',
  PASSPORT = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  RESIDENCE_PERMIT = 'RESIDENCE_PERMIT',
}

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
