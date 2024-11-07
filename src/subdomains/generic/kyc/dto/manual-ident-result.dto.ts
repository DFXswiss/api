import { Country } from 'src/shared/models/country/country.entity';

export enum IdentDocumentType {
  IDCARD = 'IDCARD',
  PASSPORT = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  RESIDENCE_PERMIT = 'RESIDENCE_PERMIT',
}

export enum GenderType {
  MALE = 'Male',
  FEMALE = 'Female',
}

export interface ManualIdentResult {
  gender?: GenderType;
  firstName: string;
  lastName: string;
  birthName?: string;
  birthday: Date;
  nationality: Country;
  birthplace?: string;
  identificationDocType: IdentDocumentType;
  identificationDocNumber: string;
  identificationDocUrl: string;
  identificationType: string;
}
