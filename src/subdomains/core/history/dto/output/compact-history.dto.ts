import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuyCrypto, BuyCryptoStatus } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { RefReward, RewardStatus } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';

export enum CompactHistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
  REFERRAL = 'Referral',
}

export enum CompactHistoryStatus {
  CREATED = 'Created',
  PENDING = 'Pending',
  FEE_TOO_HIGH = 'FeeTooHigh',
  COMPLETE = 'Complete',
  FAILED = 'Failed',
}

export class CompactHistoryDto {
  @ApiProperty({ enum: CompactHistoryTransactionType })
  type: CompactHistoryTransactionType;

  @ApiPropertyOptional()
  inputAmount?: number;

  @ApiPropertyOptional()
  inputAsset?: string;

  @ApiPropertyOptional()
  outputAmount?: number;

  @ApiPropertyOptional()
  outputAsset?: string;

  @ApiPropertyOptional()
  feeAmount?: number;

  @ApiPropertyOptional()
  feeAsset?: string;

  @ApiPropertyOptional()
  txId?: string;

  @ApiPropertyOptional()
  txUrl: string;

  @ApiProperty()
  date: Date;

  @ApiProperty()
  amlCheck: CheckStatus;

  @ApiProperty({ enum: CompactHistoryStatus })
  status: CompactHistoryStatus;

  @ApiPropertyOptional()
  amountInEur?: number;
}

export const BuyCryptoStatusMapper: {
  [key in BuyCryptoStatus]: CompactHistoryStatus;
} = {
  [BuyCryptoStatus.BATCHED]: CompactHistoryStatus.CREATED,
  [BuyCryptoStatus.CREATED]: CompactHistoryStatus.CREATED,
  [BuyCryptoStatus.MISSING_LIQUIDITY]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.PAYING_OUT]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.PENDING_LIQUIDITY]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.PREPARED]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.PRICE_MISMATCH]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.PRICE_SLIPPAGE]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.READY_FOR_PAYOUT]: CompactHistoryStatus.PENDING,
  [BuyCryptoStatus.COMPLETE]: CompactHistoryStatus.COMPLETE,
  [BuyCryptoStatus.WAITING_FOR_LOWER_FEE]: CompactHistoryStatus.FEE_TOO_HIGH,
};

export const RefRewardStatusMapper: {
  [key in RewardStatus]: CompactHistoryStatus;
} = {
  [RewardStatus.CREATED]: CompactHistoryStatus.CREATED,
  [RewardStatus.PREPARED]: CompactHistoryStatus.CREATED,
  [RewardStatus.PENDING_LIQUIDITY]: CompactHistoryStatus.PENDING,
  [RewardStatus.READY_FOR_PAYOUT]: CompactHistoryStatus.PENDING,
  [RewardStatus.PAYING_OUT]: CompactHistoryStatus.PENDING,
  [RewardStatus.COMPLETE]: CompactHistoryStatus.COMPLETE,
};

export function getStatus(entity: BuyFiat | BuyCrypto | RefReward): CompactHistoryStatus {
  if (entity instanceof RefReward) return RefRewardStatusMapper[entity.status];
  if (entity instanceof BuyCrypto && entity.status) return BuyCryptoStatusMapper[entity.status];
  if (entity.outputDate) return CompactHistoryStatus.COMPLETE;

  switch (entity.amlCheck) {
    case CheckStatus.FAIL:
      return CompactHistoryStatus.FAILED;

    case CheckStatus.PENDING:
    case CheckStatus.PASS:
      return CompactHistoryStatus.PENDING;

    default:
      return CompactHistoryStatus.CREATED;
  }
}
