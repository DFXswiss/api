import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ReviewStatus } from '../../enums/review-status.enum';

export class UpdateKycStepDto {
  @IsOptional()
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsNumber()
  sequenceNumber: number;
}
