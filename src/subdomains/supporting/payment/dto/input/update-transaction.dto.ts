import { IsEnum, IsNotEmpty } from 'class-validator';
import { TransactionType } from '../../entities/transaction.entity';

export class UpdateTransactionDto {
  @IsNotEmpty()
  @IsEnum(TransactionType)
  type: TransactionType;
}
