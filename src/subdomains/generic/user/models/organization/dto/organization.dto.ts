import { Country } from 'src/shared/models/country/country.entity';
import { LegalEntity, SignatoryPower, UserData } from '../../user-data/user-data.entity';
import { AccountOpenerAuthorization } from '../organization.entity';

export interface OrganizationDto {
  name?: string;
  street?: string;
  houseNumber?: string;
  location?: string;
  zip?: string;
  country?: Country;
  allBeneficialOwnersName?: string;
  allBeneficialOwnersDomicile?: string;
  accountOpenerAuthorization?: AccountOpenerAuthorization;
  complexOrgStructure?: boolean;
  accountOpener?: UserData;
  legalEntity?: LegalEntity;
  signatoryPower?: SignatoryPower;
}
