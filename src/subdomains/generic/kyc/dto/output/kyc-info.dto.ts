import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStepName, KycStepStatus, KycStepType, UrlType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLevel } from '../../../user/models/user-data/user-data.entity';
import { TradingLimit } from '../../../user/models/user/dto/user.dto';

export class KycSessionDto {
  @ApiProperty()
  url: string;

  @ApiProperty({ enum: UrlType })
  type: UrlType;
}

export class KycStepDto {
  @ApiProperty({ enum: KycStepName })
  name: KycStepName;

  @ApiPropertyOptional({ enum: KycStepType })
  type?: KycStepType;

  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;

  @ApiProperty()
  sequenceNumber: number;

  @ApiPropertyOptional({ type: KycSessionDto })
  session?: KycSessionDto;
}

export class KycInfoDto {
  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty({ type: KycStepDto, isArray: true })
  kycSteps: KycStepDto[];

  @ApiPropertyOptional({ type: KycStepDto })
  currentStep?: KycStepDto;
}
