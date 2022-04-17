import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { BuyCryptoSource } from '../buy-crypto.entity';

export class CreateBuyCryptoDto {
  @IsNotEmpty()
  @IsEnum(BuyCryptoSource)
  source: BuyCryptoSource;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((o) => !o.cryptoInputId || o.bankTxId)
  bankTxId: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((o) => !o.bankTxId || o.cryptoInputId)
  cryptoInputId: number;

  @IsOptional()
  @IsNumber()
  inputAmount: number;

  @IsOptional()
  @IsString()
  inputAsset: string;

  @IsOptional()
  @IsInt()
  buyId: number;
}
