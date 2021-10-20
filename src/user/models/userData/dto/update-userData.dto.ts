import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, IsEnum } from 'class-validator';
import { KycState, KycStatus } from '../userData.entity';

export class UpdateUserDataDto {
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  depositLimit: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus: KycStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(KycState)
  kycState: KycState;
}
