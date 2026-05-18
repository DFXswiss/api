import { IsOptional, IsString } from 'class-validator';
import { FileSubType } from '../../kyc/dto/kyc-file.dto';

export enum ComplianceDecision {
  ACCEPTED = 'Akzeptiert',
  REJECTED = 'Abgelehnt',
}

export const OnboardingDocSubTypes = [
  FileSubType.GWG_FILE_COVER,
  FileSubType.IDENT_REPORT,
  FileSubType.IDENTIFICATION_FORM,
  FileSubType.CUSTOMER_PROFILE,
  FileSubType.RISK_PROFILE,
  FileSubType.FORM_A,
  FileSubType.FORM_K,
  FileSubType.DFX_NAME_CHECK,
  FileSubType.PERSONAL_NAME_CHECK,
  FileSubType.BUSINESS_NAME_CHECK,
];

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
