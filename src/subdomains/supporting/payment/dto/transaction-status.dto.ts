import { ApiProperty } from '@nestjs/swagger';
import { TransactionState } from './transaction.dto';

export enum ProviderTransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  INFO_NEEDED = 'infoNeeded',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
  COMPLETED = 'completed',
}

export class TransactionStatusDto {
  @ApiProperty({ description: 'Order ID' })
  orderId: string;

  @ApiProperty({ enum: ProviderTransactionStatus, description: 'Simplified transaction status' })
  status: ProviderTransactionStatus;
}

const TransactionStateToProviderStatus: Record<TransactionState, ProviderTransactionStatus> = {
  [TransactionState.CREATED]: ProviderTransactionStatus.PENDING,
  [TransactionState.WAITING_FOR_PAYMENT]: ProviderTransactionStatus.PENDING,
  [TransactionState.PROCESSING]: ProviderTransactionStatus.PROCESSING,
  [TransactionState.LIQUIDITY_PENDING]: ProviderTransactionStatus.PROCESSING,
  [TransactionState.CHECK_PENDING]: ProviderTransactionStatus.PROCESSING,
  [TransactionState.PAYOUT_IN_PROGRESS]: ProviderTransactionStatus.PROCESSING,
  [TransactionState.UNASSIGNED]: ProviderTransactionStatus.PROCESSING,
  [TransactionState.KYC_REQUIRED]: ProviderTransactionStatus.INFO_NEEDED,
  [TransactionState.LIMIT_EXCEEDED]: ProviderTransactionStatus.INFO_NEEDED,
  [TransactionState.FAILED]: ProviderTransactionStatus.EXPIRED,
  [TransactionState.FEE_TOO_HIGH]: ProviderTransactionStatus.EXPIRED,
  [TransactionState.PRICE_UNDETERMINABLE]: ProviderTransactionStatus.EXPIRED,
  [TransactionState.RETURN_PENDING]: ProviderTransactionStatus.REFUNDED,
  [TransactionState.RETURNED]: ProviderTransactionStatus.REFUNDED,
  [TransactionState.COMPLETED]: ProviderTransactionStatus.COMPLETED,
};

export function mapToProviderStatus(state: TransactionState): ProviderTransactionStatus {
  return TransactionStateToProviderStatus[state] ?? ProviderTransactionStatus.PROCESSING;
}
