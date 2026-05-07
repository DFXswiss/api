import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MrosStatus } from '../mros-status.enum';
import { MrosPersonOverridesDto } from './mros-person-overrides.dto';

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

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MrosPersonOverridesDto)
  personOverrides?: MrosPersonOverridesDto;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  transactionIds?: number[];
}
