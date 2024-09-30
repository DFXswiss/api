export enum IdentResultType {
  SUMSUB = 'Sumsub',
  ID_NOW = 'IdNow',
}

export interface IdentResultData {
  type: IdentResultType;
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
