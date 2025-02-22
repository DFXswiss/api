import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Department } from '../enums/department.enum';
import { SupportIssueState } from '../enums/support-issue.enum';

export class UpdateSupportIssueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(SupportIssueState)
  state: SupportIssueState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clerk?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(Department)
  department?: Department;
}
