import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, ValidateIf } from 'class-validator';
import { SupportIssueType } from '../entities/support-issue.entity';

export class GetSupportIssueFilter {
  @ApiPropertyOptional({ enum: SupportIssueType })
  @IsOptional()
  @IsEnum(SupportIssueType)
  @ValidateIf((o: GetSupportIssueFilter) => Boolean(!o.id || o.type))
  type?: SupportIssueType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  @ValidateIf((o: GetSupportIssueFilter) => Boolean(!o.type || o.id))
  id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  fromMessageId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  maxLastMessages?: number;
}
