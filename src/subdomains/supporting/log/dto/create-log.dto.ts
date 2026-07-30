import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { LogSeverity } from '../log.entity';

export class CreateLogDto {
  @IsNotEmpty()
  @IsString()
  system: string;

  @IsNotEmpty()
  @IsString()
  subsystem: string;

  @IsNotEmpty()
  @IsEnum(LogSeverity)
  severity: LogSeverity;

  @IsNotEmpty()
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  category: string;

  @IsOptional()
  @IsBoolean()
  valid: boolean;

  @IsOptional()
  @IsNumber()
  totalBalanceChf?: number | null;

  @IsOptional()
  @IsNumber()
  btcPriceChf?: number | null;
}

export class UpdateLogDto {
  @IsOptional()
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  category: string;

  @IsOptional()
  @IsBoolean()
  valid: boolean;
}

export interface LogCleanupSetting {
  system: string;
  subsystem: string;
  saveDays: number;
  keepOnePerDay: boolean;
}
