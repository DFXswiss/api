import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Language } from 'src/shared/models/language/language.entity';
import { HistoryFilterKey } from 'src/subdomains/core/history/dto/history-filter.dto';
import { AccountType } from '../../user-data/account-type.enum';
import { KycState, KycStatus, LimitPeriod } from '../../user-data/user-data.entity';
import { UserStatus } from '../user.entity';
import { LinkedUserOutDto } from './linked-user.dto';

export class VolumeInformation {
  @ApiProperty()
  total: number;

  @ApiProperty()
  annual: number;
}

export class TradingLimit {
  @ApiProperty()
  limit: number;

  @ApiProperty({ enum: LimitPeriod })
  period: LimitPeriod;
}

export class UserDto {
  @ApiProperty({ enum: AccountType })
  accountType: AccountType;

  @ApiProperty()
  address: string;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ type: Fiat })
  currency: Fiat;

  @ApiProperty()
  mail: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ type: Language })
  language: Language;

  @ApiProperty({ enum: KycStatus })
  kycStatus: KycStatus;

  @ApiProperty({ enum: KycState })
  kycState: KycState;

  @ApiProperty()
  kycHash: string;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty()
  kycDataComplete: boolean;

  @ApiProperty()
  apiKeyCT: string;

  @ApiProperty({ type: String, isArray: true })
  apiFilterCT: HistoryFilterKey[];
}

export type UserDetails = Omit<UserDetailDto, keyof UserDto>;

export class UserDetailDto extends UserDto implements UserDetails {
  @ApiPropertyOptional()
  ref?: string;

  @ApiPropertyOptional()
  refFeePercent?: number;

  @ApiPropertyOptional({ description: 'refVolume in eur' })
  refVolume?: number;

  @ApiPropertyOptional()
  refCredit?: number;

  @ApiPropertyOptional()
  paidRefCredit?: number;

  @ApiPropertyOptional()
  refCount?: number;

  @ApiPropertyOptional()
  refCountActive?: number;

  @ApiProperty({ type: VolumeInformation, description: 'buyVolume in chf' })
  buyVolume: VolumeInformation;

  @ApiProperty({ type: VolumeInformation, description: 'sellVolume in chf' })
  sellVolume: VolumeInformation;

  @ApiProperty({ type: VolumeInformation, description: 'cryptoVolume in chf' })
  cryptoVolume: VolumeInformation;

  @ApiProperty()
  stakingBalance: number;

  @ApiPropertyOptional({ type: LinkedUserOutDto, isArray: true })
  linkedAddresses?: LinkedUserOutDto[];

  @ApiPropertyOptional()
  bsLink?: string;
}
