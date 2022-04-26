import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PayoutCryptoStakingDto {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNotEmpty()
  @IsNumber()
  outputAmount: number;

  @IsNotEmpty()
  @IsString()
  outputAsset: string;

  @IsNotEmpty()
  @IsString()
  outTxId: string;

  @IsOptional()
  @IsString()
  outTxId2?: string;
}
