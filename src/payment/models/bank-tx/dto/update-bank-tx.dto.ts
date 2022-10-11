import { IsEnum, IsInt, IsNotEmpty, IsNotEmptyObject, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { BankTx, BankTxType } from '../bank-tx.entity';
import { Type } from 'class-transformer';
import { EntityDto } from 'src/shared/dto/entity.dto';

export class UpdateBankTxDto {
  @IsNotEmpty()
  @IsEnum(BankTxType)
  type: BankTxType;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((p) => p.type === BankTxType.BUY_CRYPTO)
  buyId: number;

  @IsNotEmptyObject()
  @ValidateIf((p) => p.type === BankTxType.BANK_TX_RETURN)
  @ValidateNested()
  @Type(() => EntityDto)
  chargebackBankTx: BankTx;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((p) => p.type === BankTxType.BANK_TX_RETURN)
  info: string;
}
