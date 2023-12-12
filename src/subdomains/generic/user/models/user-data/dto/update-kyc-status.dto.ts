import { IsEnum, IsOptional } from 'class-validator';
import { KycState, KycStatus } from '../user-data.entity';

export class UpdateKycStatusDto {
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus;

  @IsOptional()
  @IsEnum(KycState)
  kycState: KycState;
}
