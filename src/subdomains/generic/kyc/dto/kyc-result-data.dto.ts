export enum KycResultType {
  SUMSUB = 'Sumsub',
  ID_NOW = 'IdNow',
}

export interface IdentResultData {
  type: KycResultType;
  firstname: string;
  birthname: string;
  lastname: string;
  identificationDocType: string;
  identificationDocNumber: string;
  identificationType: string;
  birthday: Date;
  nationality: string;
  success: boolean;
}
