import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReviewStatus } from '../../enums/review-status.enum';

export class UpdateKycStepDto {
  @IsNotEmpty()
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
