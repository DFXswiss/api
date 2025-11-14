import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { UserData } from '../../user-data/user-data.entity';
import { RecommendationType } from '../recommendation.entity';

export interface CreateRecommendationInternalDto {
  refCode?: string;
  mail?: string;
}

export interface UpdateRecommendationInternalDto extends UpdateRecommendationDto {
  recommended?: UserData;
  type?: RecommendationType;
  kycStep?: KycStep;
}

export class CreateRecommendationDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  mail: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  recommendedAlias: string;
}

export class UpdateRecommendationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}

export class RecommendationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  isConfirmed?: boolean;

  @ApiProperty()
  recommendedAlias: string;

  @ApiProperty()
  recommendedMail: string;
}
