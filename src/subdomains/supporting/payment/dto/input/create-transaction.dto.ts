import { IsEnum, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { TransactionSourceType, TransactionType } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  @IsNotEmpty()
  @IsNumber()
  sourceId: number;

  @IsNotEmpty()
  @IsEnum(TransactionSourceType)
  sourceType: TransactionSourceType;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}
