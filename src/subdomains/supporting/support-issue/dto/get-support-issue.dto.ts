import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { StringToArray } from 'src/shared/utils/dto-transforms';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';

export class GetSupportIssueFilter {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : +value))
  @IsInt()
  fromMessageId?: number;
}

export class GetSupportIssueListFilter {
  @ApiPropertyOptional({ enum: Department })
  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @ApiPropertyOptional({
    enum: SupportIssueInternalState,
    isArray: true,
    description: 'Comma-separated list of states',
  })
  @IsOptional()
  @StringToArray()
  @IsEnum(SupportIssueInternalState, { each: true })
  states?: SupportIssueInternalState[];

  @ApiPropertyOptional({ enum: SupportIssueType })
  @IsOptional()
  @IsEnum(SupportIssueType)
  type?: SupportIssueType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : +value))
  @IsInt()
  @Min(0)
  @Max(500)
  take?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value == null ? value : +value))
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  query?: string;
}
