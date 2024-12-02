import { Country } from 'src/shared/models/country/country.entity';

export class OrganizationDto {
  name?: string;
  street?: string;
  houseNumber?: string;
  location?: string;
  zip?: string;
  countryId?: number;
  country?: Country;
}
