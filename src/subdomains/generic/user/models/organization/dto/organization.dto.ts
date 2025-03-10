import { Country } from 'src/shared/models/country/country.entity';
import { LegalEntity, SignatoryPower, UserData } from '../../user-data/user-data.entity';

export interface OrganizationDto {
  name?: string;
  street?: string;
  houseNumber?: string;
  location?: string;
  zip?: string;
  country?: Country;
  allBeneficialOwnersName?: string;
  allBeneficialOwnersDomicile?: string;
  accountOpenerAuthorization?: string;
  complexOrgStructure?: boolean;
  accountOpener?: UserData;
  legalEntity?: LegalEntity;
  signatoryPower?: SignatoryPower;
  // TODO: temp code
  organizationName?: string;
  organizationStreet?: string;
  organizationHouseNumber?: string;
  organizationLocation?: string;
  organizationZip?: string;
  organizationCountry?: Country;
  organizationCountryId?: number;
}
