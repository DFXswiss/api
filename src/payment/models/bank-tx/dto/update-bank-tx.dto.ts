import { IsEnum, IsInt, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  @ValidateIf((p) => !p.buyId || p.type != BankTxType.BUY_CRYPTO)
  type: BankTxType;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.buyId || p.type === BankTxType.BUY_CRYPTO)
  buyId: number;
}
