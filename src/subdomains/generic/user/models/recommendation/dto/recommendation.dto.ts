import { IsBoolean, IsOptional } from 'class-validator';
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

export class UpdateRecommendationDto {
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}
