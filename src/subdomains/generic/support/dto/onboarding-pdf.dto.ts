import { IsString, IsOptional } from 'class-validator';

export class GenerateOnboardingPdfDto {
  @IsString()
  finalDecision: string;

  @IsString()
  processedBy: string;

  @IsOptional()
  @IsString()
  complexOrgStructure?: string;

  @IsOptional()
  @IsString()
  highRisk?: string;

  @IsOptional()
  @IsString()
  depositLimit?: string;

  @IsOptional()
  @IsString()
  amlAccountType?: string;

  @IsOptional()
  @IsString()
  commentGmeR?: string;

  @IsOptional()
  @IsString()
  reasonSeatingCompany?: string;

  @IsOptional()
  @IsString()
  businessActivities?: string;
}
