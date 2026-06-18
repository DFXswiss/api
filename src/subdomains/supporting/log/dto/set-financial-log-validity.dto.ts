import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class SetFinancialLogValidityDto {
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to?: Date;

  // matches FinancialDataLog entries with totalBalanceChf greater than this value
  @IsOptional()
  @IsNumber()
  min?: number;

  // matches FinancialDataLog entries with totalBalanceChf less than this value
  @IsOptional()
  @IsNumber()
  max?: number;

  @IsNotEmpty()
  @IsBoolean()
  valid: boolean;
}
