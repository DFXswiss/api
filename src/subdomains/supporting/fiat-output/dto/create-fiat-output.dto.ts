import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { FiatOutputType } from '../fiat-output.entity';

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

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

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
  city?: string;

  @IsOptional()
  @IsString()
  remittanceInfo?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  accountIban?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  valutaDate?: Date;

  @IsOptional()
  @IsString()
  bic?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  country?: string;
}
