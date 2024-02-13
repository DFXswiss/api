import { IsBoolean, IsEnum, IsInt, IsNotEmpty } from 'class-validator';

export enum CurrencyType {
  ASSET = 'Asset',
  FIAT = 'Fiat',
}

export class PriceRequest {
  @IsNotEmpty()
  @IsEnum(CurrencyType)
  fromType: CurrencyType;

  @IsNotEmpty()
  @IsInt()
  fromId: number;

  @IsNotEmpty()
  @IsEnum(CurrencyType)
  toType: CurrencyType;

  @IsNotEmpty()
  @IsInt()
  toId: number;

  @IsNotEmpty()
  @IsBoolean()
  allowExpired: boolean;
}
