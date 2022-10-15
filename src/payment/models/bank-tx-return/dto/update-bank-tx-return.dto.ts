import { IsInt, IsOptional, IsString } from 'class-validator';

export class UpdateBankTxReturnDto {
  @IsOptional()
  @IsString()
  info: string;

  @IsOptional()
  @IsInt()
  chargebackBankTxId: number;
}
