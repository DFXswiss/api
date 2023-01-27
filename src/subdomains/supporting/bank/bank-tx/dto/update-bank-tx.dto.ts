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
  accountingAmountBeforeFeeChf: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFeeChf: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;
}
