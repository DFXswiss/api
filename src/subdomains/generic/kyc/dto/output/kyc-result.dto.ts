import { ApiProperty } from '@nestjs/swagger';
import { KycStepStatus } from './kyc-info.dto';

export class KycResultDto {
  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;
}
