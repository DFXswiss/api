import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
import { AccountType } from '../../user-data/account-type.enum';
import { KycState, KycStatus } from '../../user-data/user-data.enum';
import { TradingLimit } from '../../user/dto/user.dto';

export class KycInfo {
  @ApiProperty({ enum: KycStatus, deprecated: true })
  kycStatus: KycStatus;

  @ApiProperty({ enum: KycState, deprecated: true })
  kycState: KycState;

  @ApiProperty({ deprecated: true })
  kycHash: string;

  @ApiProperty({ deprecated: true })
  kycDataComplete: boolean;

  @ApiProperty({ enum: AccountType, deprecated: true })
  accountType: AccountType;

  @ApiProperty({ type: TradingLimit, deprecated: true })
  tradingLimit: TradingLimit;

  @ApiPropertyOptional({ deprecated: true })
  sessionUrl?: string;

  @ApiPropertyOptional({ deprecated: true })
  setupUrl?: string;

  @ApiPropertyOptional({ deprecated: true })
  blankedPhone?: string;

  @ApiPropertyOptional({ deprecated: true })
  blankedMail?: string;

  @ApiProperty({ deprecated: true })
  language: LanguageDto;
}
