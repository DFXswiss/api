import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsOptional()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFee?: number;

  @IsOptional()
  @IsNumber()
  accountingFeeAmount?: number;

  @IsOptional()
  @IsNumber()
  accountingFeePercent?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFee?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountBeforeFeeChf?: number;

  @IsOptional()
  @IsNumber()
  accountingAmountAfterFeeChf?: number;

  @IsOptional()
  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p: UpdateBankTxDto) => p.type === BankTxType.BUY_CRYPTO)
  buyId?: number;
}
