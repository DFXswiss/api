import { addressExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../../user-data/user-data.entity';
import { User } from '../user.entity';
import { ReferralDto, UserAddressDto, UserV2Dto, VolumesDto } from './user-v2.dto';

export class UserDtoMapper {
  static mapUser(userData: UserData, activeUserId?: number): UserV2Dto {
    const activeUser = activeUserId && userData.users.find((u) => u.id === activeUserId);

    const dto: UserV2Dto = {
      accountId: userData.id,
      accountType: userData.accountType,
      mail: userData.mail,
      phone: userData.phone,
      language: LanguageDtoMapper.entityToDto(userData.language),
      currency: FiatDtoMapper.toDto(userData.currency),
      tradingLimit: userData.tradingLimit,
      kyc: {
        hash: userData.kycHash,
        level: userData.kycLevelDisplay,
        dataComplete: userData.isDataComplete,
      },
      volumes: this.mapVolumes(userData),
      addresses: userData.users
        .filter((u) => !u.isBlockedOrDeleted && !u.wallet.usesDummyAddresses)
        .map((u) => this.mapAddress(u, userData)),
      disabledAddresses: userData.users.filter((u) => u.isBlockedOrDeleted).map((u) => this.mapAddress(u, userData)),
      activeAddress: activeUser && this.mapAddress(activeUser, userData),
      paymentLink: {
        active: userData.paymentLinksAllowed,
      },
      apiKeyCT: userData.apiKeyCT,
      apiFilterCT: ApiKeyService.getFilterArray(userData.apiFilterCT),
    };

    return Object.assign(new UserV2Dto(), dto);
  }

  private static mapAddress(user: User, userData: UserData): UserAddressDto {
    const dto: UserAddressDto = {
      wallet: user.wallet.displayName ?? user.wallet.name,
      label: user.label,
      address: user.address,
      explorerUrl: addressExplorerUrl(user.blockchains[0], user.address),
      blockchains: user.blockchains,
      volumes: this.mapVolumes(user),
      refCode: user.ref,
      apiKeyCT: userData.apiKeyCT ?? user.apiKeyCT,
      apiFilterCT: ApiKeyService.getFilterArray(userData.apiFilterCT ?? user.apiFilterCT),
      isCustody: user.role === UserRole.CUSTODY,
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

  static mapRef(user: User, userCount: number, activeUserCount: number): ReferralDto {
    const dto: ReferralDto = {
      code: user.ref,
      commission: Util.round(user.refFeePercent / 100, 4),
      volume: user.refVolume,
      credit: user.refCredit,
      paidCredit: user.paidRefCredit,
      userCount: userCount,
      activeUserCount: activeUserCount,
    };

    return Object.assign(new ReferralDto(), dto);
  }
}
