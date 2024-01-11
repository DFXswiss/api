import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class HistoryFilter {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapHistoryQueryDto)
  buy?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapHistoryQueryDto)
  sell?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapHistoryQueryDto)
  staking?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapHistoryQueryDto)
  ref?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(Util.mapHistoryQueryDto)
  lm?: boolean;
}

export type HistoryFilterKey = keyof HistoryFilter;
