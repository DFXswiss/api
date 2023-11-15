import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycStepName, KycStepStatus } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { KycStatus } from '../../user/models/user-data/user-data.entity';

export class KycStepDto {
  @ApiProperty({ enum: KycStepName })
  name: KycStepName;

  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;

  @ApiPropertyOptional()
  sessionId?: string;
}

export class KycInfoDto {
  @ApiProperty({ enum: KycStatus })
  kycStatus: KycStatus;

  @ApiProperty({ type: KycStepDto, isArray: true })
  kycSteps: KycStepDto[];
}
