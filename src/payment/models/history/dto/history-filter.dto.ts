import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class HistoryFilter {
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

export type HistoryFilterKey = keyof HistoryFilter;
