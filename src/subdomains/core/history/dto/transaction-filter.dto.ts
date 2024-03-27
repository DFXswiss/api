import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { ExportFormat } from './history-query.dto';

export class TransactionFilter {
  @ApiPropertyOptional({ enum: ExportFormat })
  @IsNotEmpty()
  @IsEnum(ExportFormat)
  format: ExportFormat = ExportFormat.JSON;

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
