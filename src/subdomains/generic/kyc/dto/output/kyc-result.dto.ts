import { ApiProperty } from '@nestjs/swagger';
import { KycStepStatus } from '../../enums/kyc.enum';

export class KycResultDto {
  @ApiProperty({ enum: KycStepStatus })
  status: KycStepStatus;
}
