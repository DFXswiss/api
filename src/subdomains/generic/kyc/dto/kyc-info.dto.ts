import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycStatusNew } from '../../user/models/user-data/user-data.entity';
import { TradingLimit } from '../../user/models/user/dto/user.dto';

export class KycStepDto {
  @ApiProperty({ enum: KycStepName })
  name: KycStepName;

  @ApiPropertyOptional({ enum: KycStepType })
  type?: KycStepType;

  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;

  @ApiProperty()
  sequenceNumber: number;

  @ApiPropertyOptional()
  url?: string;

  @ApiPropertyOptional({ enum: UrlType })
  urlType?: UrlType;
}

export class KycInfoDto {
  @ApiProperty({ enum: KycStatusNew })
  kycStatus: KycStatusNew;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty({ type: KycStepDto, isArray: true })
  kycSteps: KycStepDto[];
}
