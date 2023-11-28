import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStepName, KycStepType, UrlType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLevel } from '../../../user/models/user-data/user-data.entity';
import { TradingLimit } from '../../../user/models/user/dto/user.dto';

export enum KycStepStatus {
  NOT_STARTED = 'NotStarted',
  IN_PROGRESS = 'InProgress',
  IN_REVIEW = 'InReview',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
}

// step
export class KycSessionInfoDto {
  @ApiProperty()
  url: string;

  @ApiProperty({ enum: UrlType })
  type: UrlType;
}

export class KycStepBase {
  @ApiProperty({ enum: KycStepName })
  name: KycStepName;

  @ApiPropertyOptional({ enum: KycStepType })
  type?: KycStepType;

  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;

  @ApiProperty()
  sequenceNumber: number;
}

export class KycStepDto extends KycStepBase {
  @ApiProperty()
  isCurrent: boolean;
}

export class KycStepSessionDto extends KycStepBase {
  @ApiProperty({ type: KycSessionInfoDto })
  session: KycSessionInfoDto;
}

// status
export class KycStatusDto {
  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty()
  twoFactorEnabled: boolean;

  @ApiProperty({ type: KycStepDto, isArray: true })
  kycSteps: KycStepDto[];
}

export class KycSessionDto extends KycStatusDto {
  @ApiPropertyOptional({ type: KycStepSessionDto })
  currentStep?: KycStepSessionDto;
}
