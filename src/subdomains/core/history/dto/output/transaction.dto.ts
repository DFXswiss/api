import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

export enum TransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CONVERT = 'Convert',
  REFERRAL = 'Referral',
}

export enum TransactionState {
  CREATED = 'Created',
  PROCESSING = 'Processing',
  AML_PENDING = 'AmlPending',
  FEE_TOO_HIGH = 'FeeTooHigh',
  COMPLETED = 'Completed',
  FAILED = 'Failed',
  RETURNED = 'Returned',
}

export class TransactionDto {
  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty({ enum: TransactionState })
  state: TransactionState;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiPropertyOptional()
  feeAmount?: number;

  @ApiPropertyOptional()
  feeAsset?: string;

  @ApiPropertyOptional()
  inputTxId?: string;

  @ApiPropertyOptional()
  inputTxUrl?: string;

  @ApiPropertyOptional()
  outputTxId?: string;

  @ApiPropertyOptional()
  outputTxUrl?: string;

  @ApiProperty({ type: Date })
  date: Date;
}
