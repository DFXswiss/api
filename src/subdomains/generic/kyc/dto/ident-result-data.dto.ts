export enum IdentResultType {
  SUMSUB = 'Sumsub',
  ID_NOW = 'IdNow',
  MANUAL = 'Manual',
}

export interface IdentResultData {
  type: IdentResultType;
  firstname: string;
  lastname: string;
  birthname: string;
  identificationDocType: string;
  identificationDocNumber: string;
  identificationType: string;
  birthday: Date;
  nationality: string;
  success: boolean;
}
