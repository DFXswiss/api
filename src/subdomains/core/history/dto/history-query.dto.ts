import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
