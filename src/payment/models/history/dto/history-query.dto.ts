import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

export class HistoryQuery {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sell?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  staking?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ref?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lm?: string;
}
