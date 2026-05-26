import { addressExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HttpMethod } from 'src/shared/enums/http-method.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/utils/util';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { UserData } from '../../user-data/user-data.entity';
import { User } from '../user.entity';
import { UserProfileDto } from './user-profile.dto';
import {
  ActionCapabilityDto,
  PhoneCallStatusMapper,
  PrerequisiteType,
  ReferralDto,
  UserAddressDto,
  UserCapabilitiesDto,
  UserV2Dto,
  VolumesDto,
} from './user-v2.dto';

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
        phoneCallAccepted: userData.phoneCallAccepted,
        phoneCallStatus: userData.phoneCallStatus ? PhoneCallStatusMapper[userData.phoneCallStatus] : undefined,
        preferredPhoneTimes: userData.phoneCallTimesObject,
      },
      capabilities: UserDtoMapper.computeCapabilities(userData),
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

  // Per-action capabilities. Mirrors the gating the realunit-app cubits
  // were re-implementing locally (settings-edit visibility) — surfacing
  // them here lets the app render UI affordances without iterating step
  // status.
  private static computeCapabilities(userData: UserData): UserCapabilitiesDto {
    const personalDataLocked = userData
      .getStepsWith(KycStepName.PERSONAL_DATA)
      .some((s) => s.isCompleted || s.isInReview);
    return {
      canEditName: !personalDataLocked,
      canEditMail: !userData.isKycTerminated,
      canEditPhone: !userData.isKycTerminated,
      canEditAddress: !personalDataLocked,
      createSupportTicket: this.computeCreateSupportTicketCapability(userData),
    };
  }

  // Structured capability for the "contact support" action: the tile must
  // stay visible for every user (incl. pre-signin), so a bool flag is not
  // enough — we surface the prerequisite (verified mail + where to fulfil it)
  // when the user cannot create a ticket directly. Replaces the
  // `supportAvailable` bool removed in api#3761; see realunit-app
  // `docs/api-authority-plan.md` (Wave 3).
  //
  // Endpoint paths are controller-relative (no `/v1` prefix). NestJS adds
  // the version prefix globally via URI versioning (main.ts), so embedding
  // it here would silently desync if `Config.defaultVersion` ever changes.
  // Treating versioning as an API-gateway concern keeps the resource path
  // canonical and matches the upstream RESTful convention.
  //
  // Empty-string mail intentionally falls into the unavailable branch —
  // mirrors `support-issue.service.ts` (`if (!userData.mail) throw …`) so
  // we never advertise an endpoint the service would reject.
  private static computeCreateSupportTicketCapability(userData: UserData): ActionCapabilityDto {
    if (userData.mail) {
      return {
        available: true,
        endpoint: { method: HttpMethod.POST, path: '/support/issue' },
      };
    }

    return {
      available: false,
      missing: [
        {
          type: PrerequisiteType.EMAIL,
          endpoint: { method: HttpMethod.POST, path: '/realunit/register/email' },
          labelKey: 'prerequisite.email',
        },
      ],
    };
  }

  private static mapVolumes(user: UserData | User): VolumesDto {
    const dto: VolumesDto = {
      buy: { total: user.buyVolume, annual: user.annualBuyVolume, monthly: user.monthlyBuyVolume },
      sell: { total: user.sellVolume, annual: user.annualSellVolume, monthly: user.monthlySellVolume },
      swap: { total: user.cryptoVolume, annual: user.annualCryptoVolume, monthly: user.monthlyCryptoVolume },
    };

    return Object.assign(new VolumesDto(), dto);
  }

  static mapRef(user: User, userCount: number, activeUserCount: number, payoutAsset: Asset): ReferralDto {
    const dto: ReferralDto = {
      code: user.ref,
      commission: Util.round(user.refFeePercent / 100, 4),
      volume: user.totalRefVolume,
      credit: user.totalRefCredit,
      paidCredit: user.paidRefCredit,
      userCount: userCount,
      activeUserCount: activeUserCount,
      payoutAsset: AssetDtoMapper.toDto(payoutAsset),
    };

    return Object.assign(new ReferralDto(), dto);
  }

  static mapProfile(userData: UserData): UserProfileDto {
    const dto: UserProfileDto = {
      accountType: userData.accountType,
      firstName: userData.firstname,
      lastName: userData.surname,
      mail: userData.mail,
      phone: userData.phone,
      address: userData.address.country
        ? { ...userData.address, country: CountryDtoMapper.entityToDto(userData.address.country) }
        : undefined,
      organizationName: userData.organization?.name,
    };

    return Object.assign(new UserProfileDto(), dto);
  }
}
