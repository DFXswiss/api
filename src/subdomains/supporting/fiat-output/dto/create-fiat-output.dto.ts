import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MinDate, ValidateIf } from 'class-validator';
import { FiatOutputType } from '../fiat-output.entity';

export const MIN_FIAT_OUTPUT_DATE = new Date('2000-01-01T00:00:00Z');

export class CreateFiatOutputDto {
  @IsOptional()
  @IsNumber()
  buyFiatId?: number;

  @IsOptional()
  @IsNumber()
  buyCryptoId?: number;

  @IsOptional()
  @IsNumber()
  bankTxReturnId?: number;

  @IsOptional()
  @IsNumber()
  bankTxRepeatId?: number;

  @IsNotEmpty()
  @IsEnum(FiatOutputType)
  type: FiatOutputType;

  @IsOptional()
  @IsNumber()
  originEntityId?: number;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsNotEmpty()
  @IsString()
  currency: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  houseNumber?: string;

  @IsNotEmpty()
  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  remittanceInfo?: string;

  @IsNotEmpty()
  @IsString()
  iban: string;

  // Deliberate deviation from the documented create-DTO convention (where @IsOptional permits both
  // undefined and null): an explicit null account IBAN has no meaning here (absent = automatic
  // assignment) and would bypass the bank-resolution invariant this module enforces, so it is
  // rejected instead of tolerated.
  @ValidateIf((_o, v) => v !== undefined)
  @IsNotEmpty()
  @IsString()
  accountIban?: string;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'valutaDate must be an ISO date on or after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  valutaDate?: Date;

  @IsOptional()
  @IsString()
  bic?: string;

  @IsNotEmpty()
  @IsString()
  zip: string;

  @IsNotEmpty()
  @IsString()
  country: string;
}
