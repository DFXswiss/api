import { Country } from 'src/shared/models/country/country.entity';
import { LegalEntity, SignatoryPower, UserData } from '../../user-data/user-data.entity';

export class OrganizationDto {
  name?: string;
  street?: string;
  houseNumber?: string;
  location?: string;
  zip?: string;
  countryId?: number;
  country?: Country;
  allBeneficialOwnersName?: string;
  allBeneficialOwnersDomicile?: string;
  accountOpenerAuthorization?: string;
  complexOrgStructure?: boolean;
  accountOpener?: UserData;
  legalEntity?: LegalEntity;
  signatoryPower?: SignatoryPower;
}
