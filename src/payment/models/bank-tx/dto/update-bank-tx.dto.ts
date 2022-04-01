import { IsInt, IsOptional } from 'class-validator';

export class UpdateBankTxDto {
  @IsOptional()
  @IsInt()
  returnBankTxId: number;

  @IsOptional()
  @IsInt()
  nextRepeatBankTxId: number;
}
