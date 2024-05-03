import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { UserData } from '../../user-data/user-data.entity';
import { User } from '../user.entity';
import { UserAddressDto, UserV2Dto, VolumesDto } from './user-v2.dto';

export class UserDtoMapper {
  static toDto(userData: UserData, activeUserId?: number): UserV2Dto {
    const activeUser = activeUserId && userData.users.find((u) => u.id === activeUserId);

    const dto: UserV2Dto = {
      accountType: userData.accountType,
      mail: userData.mail,
      phone: userData.phone,
      language: LanguageDtoMapper.entityToDto(userData.language),
      tradingLimit: userData.tradingLimit,
      kyc: {
        hash: userData.kycHash,
        level: userData.kycLevel,
        dataComplete: userData.isDataComplete,
      },
      volumes: this.mapVolumes(userData),
      addresses: userData.users.map((u) => this.mapAddress(u)),
      activeAddress: activeUser && this.mapAddress(activeUser),
    };

    return Object.assign(new UserV2Dto(), dto);
  }

  private static mapAddress(user: User): UserAddressDto {
    const dto: UserAddressDto = {
      wallet: user.wallet.name,
      address: user.address,
      blockchains: user.blockchains,
      volumes: this.mapVolumes(user),
      apiKeyCT: user.apiKeyCT,
      apiFilterCT: ApiKeyService.getFilterArray(user.apiFilterCT),
    };

    return Object.assign(new UserAddressDto(), dto);
  }

  private static mapVolumes(user: UserData | User): VolumesDto {
    const dto: VolumesDto = {
      buy: { total: user.buyVolume, annual: user.annualBuyVolume },
      sell: { total: user.sellVolume, annual: user.annualSellVolume },
      swap: { total: user.cryptoVolume, annual: user.annualCryptoVolume },
    };

    return Object.assign(new VolumesDto(), dto);
  }
}
