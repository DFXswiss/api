import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState } from '../enums/support-issue.enum';

export class UpdateSupportIssueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(SupportIssueInternalState)
  state: SupportIssueInternalState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clerk?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(Department)
  department?: Department;
}
