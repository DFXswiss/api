import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

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
}
