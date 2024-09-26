export enum KycResultType {
  SUMSUB = 'Sumsub',
  ID_NOW = 'IdNow',
  MANUAL = 'Manual',
}

export interface IdentResultData {
  type: KycResultType;
  gender?: string;
  firstname: string;
  lastname: string;
  birthname: string;
  birthplace?: string;
  identificationDocType: string;
  identificationDocNumber: string;
  identificationType: string;
  birthday: Date;
  nationality: string;
  success: boolean;
}

export interface ManualIdentResultData {}
