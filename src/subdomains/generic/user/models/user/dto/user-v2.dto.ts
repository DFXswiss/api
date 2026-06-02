import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
import { HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { AccountType } from '../../user-data/account-type.enum';
import { KycLevel, PhoneCallPreferredTime, PhoneCallStatus } from '../../user-data/user-data.enum';
import { RefPayoutFrequency } from '../user.enum';
import { TradingLimit, VolumeInformation } from './user.dto';

export enum UserPhoneCallStatus {
  UNAVAILABLE = 'Unavailable',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
}

export enum MissingPrerequisite {
  EMAIL = 'Email',
}

export const PhoneCallStatusMapper: {
  [key in PhoneCallStatus]: UserPhoneCallStatus;
} = {
  [PhoneCallStatus.REPEAT]: undefined,
  [PhoneCallStatus.USER_REJECTED]: undefined,
  [PhoneCallStatus.MANUAL_CHECK]: undefined,
  [PhoneCallStatus.UNAVAILABLE]: UserPhoneCallStatus.UNAVAILABLE,
  [PhoneCallStatus.FAILED]: UserPhoneCallStatus.FAILED,
  [PhoneCallStatus.COMPLETED]: UserPhoneCallStatus.COMPLETED,
  [PhoneCallStatus.SUSPICIOUS]: UserPhoneCallStatus.FAILED,
};

export class VolumesDto {
  @ApiProperty({ type: VolumeInformation, description: 'Total buy volume in CHF' })
  buy: VolumeInformation;

  @ApiProperty({ type: VolumeInformation, description: 'Total sell volume in CHF' })
  sell: VolumeInformation;

  @ApiProperty({ type: VolumeInformation, description: 'Total swap volume in CHF' })
  swap: VolumeInformation;
}

export class ReferralDto {
  @ApiPropertyOptional()
  code?: string;

  @ApiProperty({ description: 'Referral commission factor' })
  commission: number;

  @ApiProperty({ description: 'Referral volume in EUR' })
  volume: number;

  @ApiProperty({ description: 'Referral credit in EUR' })
  credit: number;

  @ApiProperty({ description: 'Paid referral credit in EUR' })
  paidCredit: number;

  @ApiProperty({ description: 'Number of users referred' })
  userCount: number;

  @ApiProperty({ description: 'Number of active users referred' })
  activeUserCount: number;

  @ApiProperty({ description: 'Referral payout asset' })
  payoutAsset: AssetDto;
}

export class UpdateRefDto {
  @ApiPropertyOptional({ type: EntityDto, description: 'Referral payout asset' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  payoutAsset?: Asset;

  @ApiPropertyOptional({ enum: RefPayoutFrequency, description: 'Referral payout frequency' })
  @IsOptional()
  @IsEnum(RefPayoutFrequency)
  payoutFrequency?: RefPayoutFrequency;
}

export class UserAddressDto {
  @ApiProperty()
  wallet: string;

  @ApiPropertyOptional()
  label?: string;

  @ApiProperty()
  address: string;

  @ApiPropertyOptional()
  explorerUrl?: string;

  @ApiProperty({ enum: Blockchain, isArray: true })
  blockchains: Blockchain[];

  @ApiProperty({ type: VolumesDto })
  volumes: VolumesDto;

  @ApiPropertyOptional()
  refCode?: string;

  @ApiPropertyOptional()
  apiKeyCT?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  apiFilterCT?: HistoryFilterKey[];

  @ApiProperty()
  isCustody: boolean;
}

export class UserKycDto {
  @ApiProperty()
  hash: string;

  @ApiProperty({ enum: KycLevel })
  level: KycLevel;

  @ApiProperty()
  dataComplete: boolean;

  @ApiProperty({ enum: PhoneCallPreferredTime, isArray: true })
  preferredPhoneTimes: PhoneCallPreferredTime[];

  @ApiPropertyOptional()
  phoneCallAccepted: boolean;

  @ApiPropertyOptional({ enum: UserPhoneCallStatus })
  phoneCallStatus: UserPhoneCallStatus;
}

export class UserPaymentLinkDto {
  @ApiProperty()
  active: boolean;
}

export class CreateSupportTicketCapabilityDto {
  @ApiProperty({
    description:
      'Capability gate for creating a support ticket. Mirrors the server-side prerequisite check enforced by `POST /v1/support/issue`.',
  })
  available: boolean;

  @ApiPropertyOptional({
    enum: MissingPrerequisite,
    description:
      'The single prerequisite blocking ticket creation. Present when `available` is false; omitted when `available` is true. Clients map the value to the matching capture flow (e.g. mail registration).',
  })
  missingPrerequisite?: MissingPrerequisite;
}

// Internal discriminated union mirroring CreateSupportTicketCapabilityDto.
// Mappers should return this type so the compiler enforces the
// invariant `!available implies missingPrerequisite defined` and
// `available implies missingPrerequisite absent`. The class above
// stays the surface for Swagger generation.
export type CreateSupportTicketCapability =
  | { available: true }
  | { available: false; missingPrerequisite: MissingPrerequisite };

export class UserCapabilitiesDto {
  @ApiProperty({
    description:
      'Whether the user may edit their first/last name. False when the personal-data step is in any review or completed state.',
  })
  canEditName: boolean;

  @ApiProperty({
    description: 'Whether the user may edit their primary email address.',
  })
  canEditMail: boolean;

  @ApiProperty({
    description: 'Whether the user may edit their phone number.',
  })
  canEditPhone: boolean;

  @ApiProperty({
    description: 'Whether the user may edit their postal address.',
  })
  canEditAddress: boolean;

  @ApiPropertyOptional({
    type: CreateSupportTicketCapabilityDto,
    description:
      'Per-user gate for the support-ticket flow. When `available` is false, the client must satisfy `missingPrerequisite` before calling `POST /v1/support/issue`. Optional in the schema for client SDKs pinned to older API versions; the mapper always emits it.',
  })
  createSupportTicket?: CreateSupportTicketCapabilityDto;
}

export class UserV2Dto {
  @ApiProperty({ description: 'Unique account id' })
  accountId: number;

  @ApiPropertyOptional({ enum: AccountType })
  accountType?: AccountType;

  @ApiPropertyOptional()
  mail?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiProperty({ type: LanguageDto })
  language: LanguageDto;

  @ApiProperty({ type: FiatDto })
  currency: FiatDto;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty({ type: UserKycDto })
  kyc: UserKycDto;

  @ApiProperty({
    type: UserCapabilitiesDto,
    description:
      'Per-action capability flags. Clients render UI affordances (edit buttons, support links, …) from this object instead of inferring them from KYC step status.',
  })
  capabilities: UserCapabilitiesDto;

  @ApiProperty({ type: VolumesDto })
  volumes: VolumesDto;

  @ApiProperty({ type: UserAddressDto, isArray: true })
  addresses: UserAddressDto[];

  @ApiProperty({ type: UserAddressDto, isArray: true })
  disabledAddresses: UserAddressDto[];

  @ApiPropertyOptional({ type: UserAddressDto })
  activeAddress?: UserAddressDto;

  @ApiProperty({ type: UserPaymentLinkDto })
  paymentLink: UserPaymentLinkDto;

  @ApiPropertyOptional()
  apiKeyCT?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  apiFilterCT?: HistoryFilterKey[];
}
