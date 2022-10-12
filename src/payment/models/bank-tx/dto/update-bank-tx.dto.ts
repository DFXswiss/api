import { IsEnum, IsInt, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BANK_TX_RETURN)
  chargebackBankTxId: number;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((p) => p.type === BankTxType.BANK_TX_RETURN)
  info: string;
}
