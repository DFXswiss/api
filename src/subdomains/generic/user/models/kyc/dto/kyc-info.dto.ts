import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '../../user-data/account-type.enum';
import { KycStatus, KycState } from '../../user-data/user-data.entity';
import { TradingLimit } from '../../user/dto/user.dto';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';

export class KycInfo {
  @ApiProperty({ enum: KycStatus })
  kycStatus: KycStatus;

  @ApiProperty({ enum: KycState })
  kycState: KycState;

  @ApiProperty()
  kycHash: string;

  @ApiProperty()
  kycDataComplete: boolean;

  @ApiProperty({ enum: AccountType })
  accountType: AccountType;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiPropertyOptional()
  sessionUrl?: string;

  @ApiPropertyOptional()
  setupUrl?: string;

  @ApiPropertyOptional()
  blankedPhone?: string;

  @ApiPropertyOptional()
  blankedMail?: string;

  @ApiProperty()
  language: LanguageDto;
}
