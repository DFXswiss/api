import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionDto } from '../../../supporting/payment/dto/transaction.dto';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCryptoStatus } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { ExportType } from '../services/history.service';
import { ChainReportCsvHistoryDto } from './output/chain-report-history.dto';
import { CoinTrackingCsvHistoryDto } from './output/coin-tracking-history.dto';

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

export type HistoryDto<T> = T extends ExportType.COMPACT
  ? TransactionDto
  : T extends ExportType.COIN_TRACKING
  ? CoinTrackingCsvHistoryDto
  : ChainReportCsvHistoryDto;

export class HistoryDtoDeprecated {
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
  [BuyCryptoStatus.PRICE_INVALID]: PaymentStatus.PENDING,
  [BuyCryptoStatus.PRICE_SLIPPAGE]: PaymentStatus.PENDING,
  [BuyCryptoStatus.READY_FOR_PAYOUT]: PaymentStatus.PENDING,
  [BuyCryptoStatus.STOPPED]: PaymentStatus.PENDING,
  [BuyCryptoStatus.COMPLETE]: PaymentStatus.COMPLETE,
  [BuyCryptoStatus.WAITING_FOR_LOWER_FEE]: PaymentStatus.FEE_TOO_HIGH,
};

export class TypedHistoryDto extends HistoryDtoDeprecated {
  @ApiProperty({ enum: HistoryTransactionType })
  type: HistoryTransactionType;
}
