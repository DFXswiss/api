import { IsDateString, IsOptional, IsString } from 'class-validator';

export class MrosPersonOverridesDto {
  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  birthPlace?: string;

  @IsOptional()
  @IsString()
  profession?: string;

  @IsOptional()
  @IsString()
  sourceOfWealth?: string;

  @IsOptional()
  @IsString()
  canton?: string;

  @IsOptional()
  @IsDateString()
  idDocIssueDate?: string;

  @IsOptional()
  @IsDateString()
  idDocValidUntil?: string;

  @IsOptional()
  @IsString()
  idDocIssuingCountryCode?: string;
}
