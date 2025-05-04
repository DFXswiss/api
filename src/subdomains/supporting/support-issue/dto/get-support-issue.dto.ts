import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class GetSupportIssueFilter {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value != null ? +value : value))
  @IsInt()
  fromMessageId?: number;
}
