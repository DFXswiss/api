import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateBankTxRepeatDto {
  @IsOptional()
  @IsString()
  info: string;

  @IsOptional()
  @IsInt()
  sourceBankTxId: number;

  @IsOptional()
  @IsInt()
  chargebackBankTxId: number;

  @IsOptional()
  @IsInt()
  userId: number;

  @IsOptional()
  @IsNumber()
  amountInChf: number;

  @IsOptional()
  @IsNumber()
  amountInEur: number;

  @IsOptional()
  @IsNumber()
  amountInUsd: number;
}
