import { addressExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { CountryDtoMapper } from 'src/shared/models/country/dto/country-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { Util } from 'src/shared/utils/util';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { requiredKycSteps } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLevel } from '../../user-data/user-data.enum';
import { UserData } from '../../user-data/user-data.entity';
import { User } from '../user.entity';
import { UserProfileDto } from './user-profile.dto';
import {
  PhoneCallStatusMapper,
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
        canTrade: UserDtoMapper.computeCanTrade(userData),
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
  // were re-implementing locally (settings-edit visibility, support-link
  // visibility) — surfacing them here lets the app render UI affordances
  // without iterating step status.
  private static computeCapabilities(userData: UserData): UserCapabilitiesDto {
    const personalDataLocked = userData
      .getStepsWith(KycStepName.PERSONAL_DATA)
      .some((s) => s.isCompleted || s.isInReview);
    const hasVerifiedMail = !!userData.mail;
    return {
      canEditName: !personalDataLocked,
      canEditMail: !userData.isKycTerminated,
      canEditPhone: !userData.isKycTerminated,
      canEditAddress: !personalDataLocked,
      supportAvailable: hasVerifiedMail,
    };
  }

  // Authoritative trading-permission flag. Mirrors the routing rule the
  // realunit-app cubit was reimplementing locally: numeric level alone is
  // not enough — a level-50 user with an `Outdated` Ident step is *not*
  // tradeable until the expired step is re-done. See
  // `docs/api-authority-plan.md` (Wave 2) in the app repo.
  private static computeCanTrade(userData: UserData): boolean {
    if (userData.isKycTerminated || userData.isBlocked) return false;
    if (userData.kycLevel < KycLevel.LEVEL_30) return false;

    const required = requiredKycSteps(userData);
    if (!required.every((rs) => userData.hasCompletedStep(rs))) return false;

    // Any non-Completed Ident or FinancialData step (Outdated / InProgress /
    // InReview / OnHold / Failed) blocks trading even if an earlier
    // sequence of the same step was once Completed.
    const blocking = [KycStepName.IDENT, KycStepName.FINANCIAL_DATA];
    for (const name of blocking) {
      const blocked = userData
        .getStepsWith(name)
        .some(
          (s) =>
            s.isInProgress || s.isInReview || s.isOnHold || s.isOutdated || s.isFailed,
        );
      if (blocked) return false;
    }

    return true;
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
