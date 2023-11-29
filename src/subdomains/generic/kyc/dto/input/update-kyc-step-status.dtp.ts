import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { KycStepStatus } from '../output/kyc-info.dto';

export class UpdateKycStepStatusDto {
  @IsNotEmpty()
  @IsEnum(KycStepStatus)
  status: KycStepStatus;

  @IsOptional()
  @IsString()
  result: string;
}
