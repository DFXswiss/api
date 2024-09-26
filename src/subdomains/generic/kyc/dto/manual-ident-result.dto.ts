import { Country } from 'src/shared/models/country/country.entity';

export enum DocumentType {
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
  firstName: string;
  lastName: string;
  birthName: string;
  documentType: DocumentType;
  documentNumber?: string;
  nationality: Country;
  birthplace: string;
  gender: GenderType;
  file: string;
}
