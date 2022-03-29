import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { BankTxType } from '../bank-tx.entity';

export class UpdateBankTxDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(BankTxType)
  txType: BankTxType;
}
