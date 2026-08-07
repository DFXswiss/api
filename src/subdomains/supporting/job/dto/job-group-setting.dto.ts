import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsPositive } from 'class-validator';
import { JobGroup } from '../enums';

export class JobGroupSettingDto {
  @IsNotEmpty()
  @IsEnum(JobGroup)
  group: JobGroup;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxWaitSeconds?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxRunSeconds?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxAttempts?: number;

  @IsOptional()
  @IsBoolean()
  exposeResult?: boolean;
}
