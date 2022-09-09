import { IsEnum, IsInt, IsNotEmpty, ValidateIf } from 'class-validator';
import { BankTxType } from '../fiat-output.entity';

export class UpdateFiatOutputDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;
}
