import { IsInt, IsNotEmpty, ValidateIf } from 'class-validator';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsInt()
  @ValidateIf((o) => !o.nextRepeatBankTxId || o.returnBankTxId)
  returnBankTxId: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((o) => !o.returnBankTxId || o.nextRepeatBankTxId)
  nextRepeatBankTxId: number;
}
