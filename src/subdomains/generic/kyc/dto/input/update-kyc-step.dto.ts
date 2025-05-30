import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { KycStepStatus } from '../../enums/kyc.enum';

export class UpdateKycStepDto {
  @IsNotEmpty()
  @IsEnum(KycStepStatus)
  status: KycStepStatus;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
