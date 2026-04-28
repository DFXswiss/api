import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsInt, IsObject, IsString, ValidateNested } from 'class-validator';
import { IsOptionalButNotNull } from 'src/shared/validators/is-not-null.validator';
import { MrosStatus } from '../mros-status.enum';
import { MrosPersonOverridesDto } from './mros-person-overrides.dto';

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

  @IsOptionalButNotNull()
  @IsObject()
  @ValidateNested()
  @Type(() => MrosPersonOverridesDto)
  personOverrides?: MrosPersonOverridesDto;

  @IsOptionalButNotNull()
  @IsArray()
  @IsInt({ each: true })
  transactionIds?: number[];
}
