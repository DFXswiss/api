import { IsEnum, IsInt, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsOptional()
  @IsInt()
  buyId: number;
}
