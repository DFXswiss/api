import { IsBoolean, IsOptional } from 'class-validator';
import { UserData } from '../../user-data/user-data.entity';

export interface CreateRecommendationInternalDto {
  refCode?: string;
  mail?: string;
}

export interface UpdateRecommendationInternalDto extends UpdateRecommendationDto {
  recommended?: UserData;
}

export class UpdateRecommendationDto {
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}
