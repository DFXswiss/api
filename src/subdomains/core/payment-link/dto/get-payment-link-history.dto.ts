import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

export class GetPaymentLinkHistoryDto {
  @ApiPropertyOptional({ description: 'Comma-separated list of statuses. Default is "completed"' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'From date (yyyy-mm-dd). Default is first day of current month' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: 'To date (yyyy-mm-dd). Default is last day of current month' })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to?: Date;
}
