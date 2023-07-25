import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuyCryptoStatus } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';

export enum HistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

export enum PaymentStatus {
  PENDING = 'Pending',
  FEE_TOO_HIGH = 'FeeTooHigh',
  COMPLETE = 'Complete',
}

export class HistoryDto {
  @ApiProperty()
  inputAmount: number;

  @ApiProperty()
  inputAsset: string;

  @ApiPropertyOptional()
  outputAmount: number;

  @ApiPropertyOptional()
  outputAsset: string;

  @ApiPropertyOptional()
  txId: string;

  @ApiPropertyOptional()
  txUrl: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  amlCheck: CheckStatus;

  @ApiProperty({ deprecated: true })
  isComplete: boolean;

  @ApiProperty()
  status: PaymentStatus;
}

export const PaymentStatusMapper: {
  [key in BuyCryptoStatus]: PaymentStatus;
} = {
  [BuyCryptoStatus.BATCHED]: PaymentStatus.PENDING,
  [BuyCryptoStatus.CREATED]: PaymentStatus.PENDING,
  [BuyCryptoStatus.MISSING_LIQUIDITY]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PAYING_OUT]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PENDING_LIQUIDITY]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PREPARED]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PRICE_MISMATCH]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PRICE_SLIPPAGE]: PaymentStatus.PENDING,
  [BuyCryptoStatus.READY_FOR_PAYOUT]: PaymentStatus.PENDING,
  [BuyCryptoStatus.COMPLETE]: PaymentStatus.COMPLETE,
  [BuyCryptoStatus.WAITING_FOR_LOWER_FEE]: PaymentStatus.FEE_TOO_HIGH,
};

export class TypedHistoryDto extends HistoryDto {
  @ApiProperty({ enum: HistoryTransactionType })
  type: HistoryTransactionType;
}
