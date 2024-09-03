import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { SupportIssueType } from '../entities/support-issue.entity';

export class GetSupportIssueFilter {
  @ApiPropertyOptional({ enum: SupportIssueType })
  @IsOptional()
  @IsEnum(SupportIssueType)
  type?: SupportIssueType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  fromMessageId?: number;
}
