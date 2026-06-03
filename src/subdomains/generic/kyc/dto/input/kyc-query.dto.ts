import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { KycContext } from '../../enums/kyc.enum';

export class KycQueryDto {
  @ApiPropertyOptional({ enum: KycContext, description: 'KYC context to filter required steps per flow' })
  @IsOptional()
  @IsEnum(KycContext)
  context?: KycContext;
}

export class KycContinueQueryDto extends KycQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  autoStep?: string;
}
