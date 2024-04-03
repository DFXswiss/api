import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class TransactionFilter {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to?: Date;
}
