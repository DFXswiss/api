import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class HistoryFilter {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  buy?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  sell?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  staking?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  ref?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  lm?: boolean;
}

export type HistoryFilterKey = keyof HistoryFilter;
