import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExportType } from '../services/history.service';
import { HistoryFilter } from './history-filter.dto';

export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json',
}

export class HistoryQuery extends HistoryFilter {
  @ApiPropertyOptional({ enum: ExportFormat })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

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

  @ApiPropertyOptional({ enum: Blockchain, description: 'Semicolon separated string of Blockchains' })
  @IsOptional()
  @IsString()
  blockchains?: string;

  @ApiPropertyOptional({ description: 'Maximum number of transactions to return', default: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of transactions to skip', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}

export class HistoryQueryUser extends HistoryQuery {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  userAddress: string;
}

export class HistoryQueryExportType extends HistoryQuery {
  @ApiPropertyOptional({ enum: ExportType })
  @IsOptional()
  @IsEnum(ExportType)
  type: ExportType = ExportType.COIN_TRACKING;
}
