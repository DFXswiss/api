import { IsBoolean, IsDate, IsNumber, IsOptional, IsString } from 'class-validator';
import { TransactionCharge } from '../../bank-tx/frick.service';

export class UpdateFiatOutputDto {
  @IsOptional()
  @IsNumber()
  typeId?: number;

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
  postalCode?: string;

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
  @IsDate()
  isReadyDate?: Date;

  @IsOptional()
  @IsDate()
  isTransmittedDate?: Date;

  @IsOptional()
  @IsDate()
  isConfirmedDate?: Date;

  @IsOptional()
  @IsDate()
  isApprovedDate?: Date;

  @IsOptional()
  @IsString()
  info?: string;

  @IsOptional()
  @IsDate()
  outputDate?: Date;

  @IsOptional()
  @IsNumber()
  bankTxId?: number;
}
