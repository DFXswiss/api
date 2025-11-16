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
  confirmationDate?: Date;
}

export class CreateRecommendationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mail: string;

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
