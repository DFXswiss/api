import { IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, Max, Min } from 'class-validator';

export class RefBonusAgreementDto {
  @IsNotEmpty()
  @IsString()
  usedRef: string;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  userId: number;

  @IsNotEmpty()
  @IsInt()
  @IsPositive()
  outputAssetId: number;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @Max(1)
  feeShare: number; // fraction of the fixed fee paid out, e.g. 0.5

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  minTransactionId: number;
}
