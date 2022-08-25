import { IsOptional, IsEnum } from 'class-validator';
import { KycState, KycStatus } from '../user-data.entity';

export class UpdateUserDataKycDto {
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus;

  @IsOptional()
  @IsEnum(KycState)
  kycState: KycState;
}
