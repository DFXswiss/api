import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentMethod, PaymentMethodSwagger } from 'src/subdomains/supporting/payment/dto/payment-method.enum';

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

  @ApiPropertyOptional({ description: 'Fiat ID for buy transactions, asset ID otherwise' })
  inputAssetId?: number;

  @ApiPropertyOptional({ enum: Blockchain })
  inputBlockchain?: Blockchain;

  @ApiPropertyOptional({ enum: PaymentMethodSwagger })
  inputPaymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Exchange rate in input/output' })
  exchangeRate?: number;

  @ApiPropertyOptional({ description: 'Final rate (incl. fees) in input/output' })
  rate?: number;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional({ description: 'Fiat ID for sell transactions, asset ID otherwise' })
  outputAssetId?: number;

  @ApiPropertyOptional({ enum: Blockchain })
  outputBlockchain?: Blockchain;

  @ApiPropertyOptional({ enum: PaymentMethodSwagger })
  outputPaymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Fee amount in input asset' })
  feeAmount?: number;

  @ApiPropertyOptional({ deprecated: true })
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
