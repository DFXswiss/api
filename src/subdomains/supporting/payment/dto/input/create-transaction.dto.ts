import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';
import { TransactionSourceType } from '../../entities/transaction.entity';

export class CreateTransactionDto {
  @IsNotEmpty()
  @IsNumber()
  sourceId: number;

  @IsNotEmpty()
  @IsEnum(TransactionSourceType)
  sourceType: TransactionSourceType;
}
