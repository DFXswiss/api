export enum IdentType {
  SUM_SUB = 'Sumsub',
  ID_NOW = 'IdNow',
  MANUAL = 'Manual',
}

export interface IdentResultData {
  type: IdentType;
  firstname: string;
  lastname: string;
  birthname: string;
  documentType: string;
  documentNumber: string;
  kycType: string;
  birthday: Date;
  nationality: string;
  success: boolean;
}
