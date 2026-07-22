import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNumber, IsOptional, IsString, MinDate } from 'class-validator';
import { TransactionCharge } from '../fiat-output.entity';
import { MIN_FIAT_OUTPUT_DATE } from './create-fiat-output.dto';

export class UpdateFiatOutputDto {
  @IsOptional()
  @IsNumber()
  originEntityId?: number;

  @IsOptional()
  @IsString()
  accountIban?: string;

  @IsOptional()
  @IsNumber()
  batchId?: number;

  @IsOptional()
  @IsNumber()
  batchAmount?: number;

  @IsOptional()
  @IsString()
  charge?: TransactionCharge;

  @IsOptional()
  @IsBoolean()
  isInstant?: boolean;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'valutaDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  valutaDate?: Date;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  remittanceInfo?: string;

  @IsOptional()
  @IsNumber()
  accountNumber?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  houseNumber?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  aba?: string;

  @IsOptional()
  @IsString()
  bic?: string;

  @IsOptional()
  @IsString()
  creditInstitution?: string;

  @IsOptional()
  @IsString()
  pmtInfId?: string;

  @IsOptional()
  @IsString()
  instrId?: string;

  @IsOptional()
  @IsString()
  endToEndId?: string;

  @IsOptional()
  @IsBoolean()
  isComplete?: boolean;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'isReadyDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  isReadyDate?: Date;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'isTransmittedDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  isTransmittedDate?: Date;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'isConfirmedDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  isConfirmedDate?: Date;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'isApprovedDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  isApprovedDate?: Date;

  @IsOptional()
  @IsString()
  info?: string;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_FIAT_OUTPUT_DATE, {
    message: 'outputDate must be an ISO date after 2000-01-01 (numeric spreadsheet date serials are rejected)',
  })
  @Type(() => Date)
  outputDate?: Date;

  @IsOptional()
  @IsNumber()
  bankTxId?: number;
}
