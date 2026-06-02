import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LanguageDto } from 'src/shared/models/language/dto/language.dto';
import { KycStepType, UrlType } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
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

export enum KycProcessStatus {
  IN_PROGRESS = 'InProgress',
  PENDING_REVIEW = 'PendingReview',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
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

  @ApiProperty({
    description:
      'Whether this step is required for the user to complete KYC (drives app-side routing instead of duplicating requiredKycSteps())',
  })
  isRequired: boolean;
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

  @ApiProperty({
    enum: KycProcessStatus,
    description:
      'High-level KYC process status. `Completed` ⇒ all required steps completed; `PendingReview` ⇒ at least one required step is in backend review; `InProgress` ⇒ at least one required step is actionable by the user; `Failed` ⇒ KYC terminated. Clients render this verbatim instead of inferring it from `kycSteps`.',
  })
  processStatus: KycProcessStatus;
}

export class KycSessionDto extends KycLevelDto {
  @ApiPropertyOptional({ type: KycStepSessionDto })
  currentStep?: KycStepSessionDto;
}
