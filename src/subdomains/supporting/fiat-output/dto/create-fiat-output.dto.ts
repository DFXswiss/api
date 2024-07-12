import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFiatOutputDto {
  @IsOptional()
  @IsNumber()
  buyFiatId?: number;

  @IsOptional()
  @IsNumber()
  buyCryptoId?: number;

  @IsNotEmpty()
  @IsString()
  type: string;

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
}
