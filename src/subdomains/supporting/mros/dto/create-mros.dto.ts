import { IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MrosStatus } from '../mros-status.enum';

export class CreateMrosDto {
  @IsNotEmpty()
  @IsInt()
  userDataId: number;

  @IsNotEmpty()
  @IsEnum(MrosStatus)
  status: MrosStatus;

  @IsOptional()
  @IsDateString()
  submissionDate?: Date;

  @IsOptional()
  @IsString()
  authorityReference?: string;

  @IsNotEmpty()
  @IsString()
  caseManager: string;

  @IsOptional()
  @IsString()
  reportCode?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  indicators?: string[];
}
