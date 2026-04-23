import { IsArray, IsDateString, IsEnum, IsString } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { MrosStatus } from '../mros-status.enum';

export class UpdateMrosDto {
  @IsOptionalButNotNull()
  @IsEnum(MrosStatus)
  status?: MrosStatus;

  @IsOptionalButNotNull()
  @IsDateString()
  submissionDate?: Date;

  @IsOptionalButNotNull()
  @IsString()
  authorityReference?: string;

  @IsOptionalButNotNull()
  @IsString()
  caseManager?: string;

  @IsOptionalButNotNull()
  @IsString()
  reportCode?: string;

  @IsOptionalButNotNull()
  @IsString()
  reason?: string;

  @IsOptionalButNotNull()
  @IsString()
  action?: string;

  @IsOptionalButNotNull()
  @IsArray()
  @IsString({ each: true })
  indicators?: string[];
}
