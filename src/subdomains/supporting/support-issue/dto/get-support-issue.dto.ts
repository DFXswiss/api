import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { StringToArray } from 'src/shared/utils/dto-transforms';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState, SupportIssueType } from '../enums/support-issue.enum';

export enum SupportIssueListOrderBy {
  CREATED = 'created',
  UPDATED = 'updated',
  CLERK = 'clerk',
  DEPARTMENT = 'department',
  STATE = 'state',
}

// Values are the literal SQL directions TypeORM's orderBy expects, hence uppercase rather than
// the usual PascalCase enum-value convention.
export enum ListOrderDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}

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

  @ApiPropertyOptional({ description: 'Filter by handling clerk (exact match)' })
  @IsOptional()
  @IsString()
  clerk?: string;

  @ApiPropertyOptional({ description: 'Filter issues created on or after this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Filter issues created on or before this date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ enum: SupportIssueListOrderBy, description: 'Sort field (default: created)' })
  @IsOptional()
  @IsEnum(SupportIssueListOrderBy)
  orderBy?: SupportIssueListOrderBy;

  @ApiPropertyOptional({ enum: ListOrderDirection, description: 'Sort direction (default: DESC)' })
  @IsOptional()
  @IsEnum(ListOrderDirection)
  orderDir?: ListOrderDirection;

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
