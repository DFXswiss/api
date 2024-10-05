export enum IdentType {
  SUM_SUB = 'Sumsub',
  ID_NOW = 'IdNow',
}

export interface IdentResultData {
  type: IdentType;
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
