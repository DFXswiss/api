import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class SetFinancialLogValidityDto {
  // inclusive lower bound: matches entries with created >= from
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from?: Date;

  // exclusive upper bound: matches entries with created < to (half-open window, e.g. a full day = [day, nextDay))
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to?: Date;

  // matches entries with totalBalanceChf greater than this value (exclusive)
  @IsOptional()
  @IsNumber()
  min?: number;

  // matches entries with totalBalanceChf less than this value (exclusive)
  @IsOptional()
  @IsNumber()
  max?: number;

  @IsNotEmpty()
  @IsBoolean()
  valid: boolean;
}
