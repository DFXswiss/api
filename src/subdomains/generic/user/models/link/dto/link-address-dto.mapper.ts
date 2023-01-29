import { LinkAddress } from '../link-address.entity';
import { LinkAddressDto } from './link-address.dto';

export class LinkAddressDtoMapper {
  static entityToDto(linkAddress: LinkAddress): LinkAddressDto {
    const dto: LinkAddressDto = {
      id: linkAddress.id,
      existingAddress: linkAddress.existingAddress,
      newAddress: linkAddress.newAddress,
      authentication: linkAddress.authentication,
      expiration: linkAddress.expiration,
      isCompleted: linkAddress.isCompleted,
    };

    return Object.assign(new LinkAddressDto(), dto);
  }
}
