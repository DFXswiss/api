import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { UserData } from '../../user-data/user-data.entity';
import { RecommendationType } from '../recommendation.entity';

export interface UpdateRecommendationInternalDto extends UpdateRecommendationDto {
  recommended?: UserData;
  type?: RecommendationType;
  kycStep?: KycStep;
  confirmationDate?: Date;
}

export class CreateRecommendationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(Util.trim)
  recommendedMail: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  recommendedAlias: string;
}

export class UpdateRecommendationDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsBoolean()
  isConfirmed?: boolean;
}

export class RecommendationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  type: RecommendationType;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  mail?: string;

  @ApiPropertyOptional()
  confirmationDate?: Date;

  @ApiPropertyOptional()
  expirationDate: Date;

  @ApiPropertyOptional()
  isConfirmed?: boolean;

  @ApiProperty()
  isExpired: boolean;
}
