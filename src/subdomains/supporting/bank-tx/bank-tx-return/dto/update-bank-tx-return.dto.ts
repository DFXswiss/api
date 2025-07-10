import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateBankTxReturnDto {
  @IsOptional()
  @IsString()
  info?: string;

  @IsOptional()
  @IsNumber()
  amountInChf?: number;

  @IsOptional()
  @IsNumber()
  amountInEur?: number;

  @IsOptional()
  @IsNumber()
  amountInUsd?: number;
}
