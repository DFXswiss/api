import { Country } from 'src/shared/models/country/country.entity';
import { IdentDocumentType } from './ident-result-data.dto';

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
  documentType: IdentDocumentType;
  documentNumber: string;
  documentUrl: string;
  kycType: string;
}
