import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNumber, IsOptional, IsString } from 'class-validator';
import { TransactionCharge } from '../fiat-output.entity';

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
  @Type(() => Date)
  isReadyDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  isTransmittedDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  isConfirmedDate?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  isApprovedDate?: Date;

  @IsOptional()
  @IsString()
  info?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  outputDate?: Date;

  @IsOptional()
  @IsNumber()
  bankTxId?: number;
}
