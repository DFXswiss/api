export enum KycResultType {
  SUMSUB = 'Sumsub',
  ID_NOW = 'IdNow',
}

export interface KycResultData {
  type: KycResultType;
  firstname: string;
  birthname: string;
  lastname: string;
  identificationDocType: string;
  identificationDocNumber: string;
  identificationType: string;
  result: string;
  birthday: Date;
  nationality: string;
}
