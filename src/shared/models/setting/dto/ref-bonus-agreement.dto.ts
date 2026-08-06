import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class RefBonusAgreementDto {
  @IsNotEmpty()
  @IsString()
  usedRef: string;

  @IsNotEmpty()
  @IsNumber()
  userId: number;

  @IsNotEmpty()
  @IsNumber()
  outputAssetId: number;

  @IsNotEmpty()
  @IsNumber()
  feeShare: number; // fraction of the fixed fee paid out, e.g. 0.5

  @IsNotEmpty()
  @IsNumber()
  minTransactionId: number;
}
