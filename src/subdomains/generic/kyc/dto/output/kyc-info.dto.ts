import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
import { KycStepType, UrlType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLevel } from '../../../user/models/user-data/user-data.entity';
import { TradingLimit } from '../../../user/models/user/dto/user.dto';
import { KycStepName } from '../../enums/kyc-step-name.enum';

export enum KycStepStatus {
  NOT_STARTED = 'NotStarted',
  IN_PROGRESS = 'InProgress',
  IN_REVIEW = 'InReview',
  FAILED = 'Failed',
  COMPLETED = 'Completed',
  OUTDATED = 'Outdated',
  DATA_REQUESTED = 'DataRequested',
  ON_HOLD = 'OnHold',
}

export enum KycStepReason {
  ACCOUNT_EXISTS = 'AccountExists',
  ACCOUNT_MERGE_REQUESTED = 'AccountMergeRequested',
}

// step
export class KycAdditionalInfoBaseDto {}

export class KycAdditionalInfoBeneficialDto extends KycAdditionalInfoBaseDto {
  @ApiProperty()
  accountHolder: string;
}

export class KycSessionInfoDto {
  @ApiProperty()
  url: string;

  @ApiProperty({ enum: UrlType })
  type: UrlType;

  @ApiPropertyOptional()
  additionalInfo?: KycAdditionalInfoBaseDto;
}

export class KycStepBase {
  @ApiProperty({ enum: KycStepName })
  name: KycStepName;

  @ApiPropertyOptional({ enum: KycStepType })
  type?: KycStepType;

  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;

  @ApiPropertyOptional({ enum: KycStepReason })
  reason?: KycStepReason;

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
export class KycLevelDto {
  @ApiProperty({ enum: KycLevel })
  kycLevel: KycLevel;

  @ApiProperty({ type: TradingLimit })
  tradingLimit: TradingLimit;

  @ApiProperty({ description: 'Connected KYC clients', isArray: true })
  kycClients: string[];

  @ApiProperty({ type: LanguageDto })
  language: LanguageDto;

  @ApiProperty({ type: KycStepDto, isArray: true })
  kycSteps: KycStepDto[];
}

export class KycSessionDto extends KycLevelDto {
  @ApiPropertyOptional({ type: KycStepSessionDto })
  currentStep?: KycStepSessionDto;
}
