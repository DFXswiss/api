import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { UserData } from '../../user-data/user-data.entity';
import { RecommendationType } from '../recommendation.entity';

export interface UpdateRecommendationInternalDto {
  recommended?: UserData;
  type?: RecommendationType;
  kycStep?: KycStep;
  confirmationDate?: Date;
  isConfirmed: boolean;
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

export class RecommendationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

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
