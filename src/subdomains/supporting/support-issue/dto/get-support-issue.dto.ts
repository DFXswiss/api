import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class GetSupportIssueFilter {
  @ApiProperty()
  @Transform(({ value }) => +value)
  @IsInt()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => +value)
  @IsInt()
  fromMessageId?: number;
}
