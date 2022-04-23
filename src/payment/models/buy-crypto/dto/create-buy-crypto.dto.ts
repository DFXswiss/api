import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBuyCryptoDto {
  // @IsNotEmpty()
  // @IsEnum(BuyCryptoSource)
  // source: BuyCryptoSource;

  @IsNotEmpty()
  @IsInt()
  // @ValidateIf((o) => !o.cryptoInputId || o.bankTxId)
  bankTxId: number;

  // @IsNotEmpty()
  // @IsInt()
  // @ValidateIf((o) => !o.bankTxId || o.cryptoInputId)
  // cryptoInputId: number;

  //TODO input hier schon rein?
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
