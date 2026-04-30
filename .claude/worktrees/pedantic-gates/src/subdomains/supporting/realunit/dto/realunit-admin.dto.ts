import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { TransactionRequestStatus, TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { TransactionTypeInternal } from '../../payment/entities/transaction.entity';

export class RealUnitAdminQueryDto {
  @ApiPropertyOptional({ description: 'Number of items to return' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({ description: 'Number of items to skip' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}

export class RealUnitQuoteDto {
  @ApiProperty({ description: 'Quote ID' })
  id: number;

  @ApiProperty({ description: 'Quote UID' })
  uid: string;

  @ApiProperty({ description: 'Quote type', enum: TransactionRequestType })
  type: TransactionRequestType;

  @ApiProperty({ description: 'Quote status', enum: TransactionRequestStatus })
  status: TransactionRequestStatus;

  @ApiProperty({ description: 'Quote amount' })
  amount: number;

  @ApiProperty({ description: 'Estimated amount' })
  estimatedAmount: number;

  @ApiProperty({ description: 'Creation date' })
  created: Date;

  @ApiPropertyOptional({ description: 'User address' })
  userAddress?: string;
}

export class RealUnitTransactionDto {
  @ApiProperty({ description: 'Transaction ID' })
  id: number;

  @ApiProperty({ description: 'Transaction UID' })
  uid: string;

  @ApiProperty({ description: 'Transaction type', enum: TransactionTypeInternal })
  type: TransactionTypeInternal;

  @ApiProperty({ description: 'Amount in CHF' })
  amountInChf: number;

  @ApiProperty({ description: 'Assets involved' })
  assets: string;

  @ApiProperty({ description: 'Creation date' })
  created: Date;

  @ApiPropertyOptional({ description: 'Output date' })
  outputDate?: Date;

  @ApiPropertyOptional({ description: 'User address' })
  userAddress?: string;
}
