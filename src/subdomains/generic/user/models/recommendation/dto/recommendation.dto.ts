import { IsBoolean, IsOptional } from 'class-validator';
import { UserData } from '../../user-data/user-data.entity';
import { RecommendationType } from '../recommendation.entity';

export interface CreateRecommendationInternalDto {
  refCode?: string;
  mail?: string;
}

export interface UpdateRecommendationInternalDto extends UpdateRecommendationDto {
  recommended?: UserData;
  type?: RecommendationType;
}

export class UpdateRecommendationDto {
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}
