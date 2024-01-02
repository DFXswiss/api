import { KycUserDataDto } from 'src/subdomains/generic/user/models/kyc/dto/kyc-user-data.dto';
import { KycPersonalData } from '../input/kyc-personal-data.dto';

export class KycDataMapper {
  static toUserData(data: KycPersonalData): KycUserDataDto {
    const dto: KycUserDataDto = {
      accountType: data.accountType,
      firstname: data.firstName,
      surname: data.lastName,
      street: data.address.street,
      houseNumber: data.address.houseNumber,
      location: data.address.city,
      zip: data.address.zip,
      country: data.address.country,
      phone: data.phone,
      organizationName: data.organizationName,
      organizationStreet: data.organizationAddress?.street,
      organizationHouseNumber: data.organizationAddress?.houseNumber,
      organizationLocation: data.organizationAddress?.city,
      organizationZip: data.organizationAddress?.zip,
      organizationCountry: data.organizationAddress?.country,
    };

    return Object.assign(new KycUserDataDto(), dto);
  }
}
