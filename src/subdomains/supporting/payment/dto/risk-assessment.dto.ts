import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AssessmentStatus, RiskType } from '../entities/transaction-risk-assessment.entity';

export class UpdateRiskAssessmentDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  methods?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  pdf?: string;

  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;
}

export class CreateRiskAssessmentDto extends UpdateRiskAssessmentDto {
  @IsNotEmpty()
  @IsEnum(RiskType)
  type: RiskType;
}
