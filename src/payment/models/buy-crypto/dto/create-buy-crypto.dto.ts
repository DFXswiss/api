import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBuyCryptoDto {
  @IsNotEmpty()
  @IsInt()
  bankTxId: number;

  @IsOptional()
  @IsInt()
  buyId: number;

  @IsOptional()
  @IsNumber()
  inputAmount: number;

  @IsOptional()
  @IsString()
  inputAsset: string;
}
