import { IsEnum, IsNotEmpty } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  txType: BankTxType;
}
