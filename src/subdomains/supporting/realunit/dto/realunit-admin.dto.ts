import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { TransactionRequestStatus, TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';

export class RealUnitAdminQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}

export class RealUnitQuoteDto {
  id: number;
  uid: string;
  type: TransactionRequestType;
  status: TransactionRequestStatus;
  amount: number;
  estimatedAmount: number;
  created: Date;
  userAddress?: string;
}

export class RealUnitTransactionDto {
  id: number;
  uid: string;
  type: TransactionTypeInternal;
  amountInChf: number;
  assets: string;
  created: Date;
  outputDate?: Date;
  userAddress?: string;
}
