import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PriceValidity } from '../services/pricing.service';

export enum CurrencyType {
  ASSET = 'Asset',
  FIAT = 'Fiat',
}

export class PriceRequest {
  @IsNotEmpty()
  @IsEnum(CurrencyType)
  fromType: CurrencyType;

  @IsNotEmpty()
  @IsString()
  fromId: string;

  @IsNotEmpty()
  @IsEnum(CurrencyType)
  toType: CurrencyType;

  @IsNotEmpty()
  @IsString()
  toId: string;

  @IsNotEmpty()
  @IsEnum(PriceValidity)
  validity: PriceValidity;
}
