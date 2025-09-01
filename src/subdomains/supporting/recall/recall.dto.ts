import { IsInt, IsNotEmpty, IsNumber, IsString, ValidateIf } from 'class-validator';

export class RecallDto {
  @IsNotEmpty()
  @IsInt()
  @ValidateIf((r: RecallDto) => Boolean(r.bankTxId || !r.checkoutTxId))
  bankTxId?: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((r: RecallDto) => Boolean(r.checkoutTxId || !r.bankTxId))
  checkoutTxId?: number;

  @IsNotEmpty()
  @IsInt()
  sequence: number;

  @IsNotEmpty()
  @IsInt()
  userId: number;

  @IsNotEmpty()
  @IsString()
  comment: string;

  @IsNotEmpty()
  @IsNumber()
  fee: number;
}
