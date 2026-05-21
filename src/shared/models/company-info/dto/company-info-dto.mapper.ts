import { CompanyInfo } from '../company-info.entity';
import { CompanyInfoAddressDto, CompanyInfoDto } from './company-info.dto';

export class CompanyInfoDtoMapper {
  static entityToDto(info: CompanyInfo): CompanyInfoDto {
    const hasAnyAddressField = info.addressStreet || info.addressZip || info.addressCity || info.addressCountry;

    const address: CompanyInfoAddressDto | undefined = hasAnyAddressField
      ? {
          street: info.addressStreet ?? undefined,
          zip: info.addressZip ?? undefined,
          city: info.addressCity ?? undefined,
          country: info.addressCountry ?? undefined,
        }
      : undefined;

    const dto: CompanyInfoDto = {
      brand: info.brand,
      name: info.name,
      phone: info.phone ?? undefined,
      email: info.email ?? undefined,
      website: info.website ?? undefined,
      address,
    };

    return Object.assign(new CompanyInfoDto(), dto);
  }
}
