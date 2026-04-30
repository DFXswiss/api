import { Country } from 'src/shared/models/country/country.entity';
import { UserData } from '../../user-data/user-data.entity';
import { LegalEntity, SignatoryPower } from '../../user-data/user-data.enum';
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
