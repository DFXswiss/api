import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { RecallReason } from '../recall-reason.enum';

export class CreateRecallDto {
  @IsNotEmpty()
  @IsInt()
  @ValidateIf((r: CreateRecallDto) => Boolean(r.bankTxId || !r.checkoutTxId))
  bankTxId?: number;

  @IsNotEmpty()
  @IsInt()
  @ValidateIf((r: CreateRecallDto) => Boolean(r.checkoutTxId || !r.bankTxId))
  checkoutTxId?: number;

  @IsNotEmpty()
  @IsInt()
  sequence: number;

  @IsOptional()
  @IsInt()
  userId?: number;

  @IsNotEmpty()
  @IsString()
  comment: string;

  @IsNotEmpty()
  @IsNumber()
  fee: number;

  @IsNotEmpty()
  @IsEnum(RecallReason)
  reason: RecallReason;
}
