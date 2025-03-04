import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { FiatDto } from 'src/shared/models/fiat/dto/fiat.dto';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
import { HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { AccountType } from '../../user-data/account-type.enum';
import { KycLevel } from '../../user-data/user-data.entity';
import { TradingLimit, VolumeInformation } from './user.dto';

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
}

export class UserPaymentLinkDto {
  @ApiProperty()
  active: boolean;
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
