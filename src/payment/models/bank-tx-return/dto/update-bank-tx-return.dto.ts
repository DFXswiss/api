import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateBankTxReturnDto {
  @IsOptional()
  @IsString()
  info: string;

  @IsOptional()
  @IsInt()
  chargebackBankTxId: number;

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
