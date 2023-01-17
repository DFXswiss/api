import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsNumber, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsOptional()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFee: number;

  @IsOptional()
  @IsNumber()
  accountingFeeAmount: number;

  @IsOptional()
  @IsNumber()
  accountingFeePercent: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFee: number;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFeeCHF: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFeeCHF: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;
}
