import { IsEnum, IsInt, IsNotEmpty, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;
}
