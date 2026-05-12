import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { RecallReason } from '../recall-reason.enum';

export class CreateRecallDto {
  @IsNotEmpty()
  @IsInt()
  bankTxId: number;

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
