import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BuyCrypto, BuyCryptoStatus } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { RefReward, RewardStatus } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import { TransactionState, TransactionType } from '../transaction/transaction.dto';

export class CompactHistoryDto {
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
  txId?: string;

  @ApiPropertyOptional()
  txUrl?: string;

  @ApiProperty({ type: Date })
  date: Date;
}

export const BuyCryptoStatusMapper: {
  [key in BuyCryptoStatus]: TransactionState;
} = {
  [BuyCryptoStatus.BATCHED]: TransactionState.PROCESSING,
  [BuyCryptoStatus.CREATED]: TransactionState.PROCESSING,
  [BuyCryptoStatus.MISSING_LIQUIDITY]: TransactionState.PROCESSING,
  [BuyCryptoStatus.PAYING_OUT]: TransactionState.PROCESSING,
  [BuyCryptoStatus.PENDING_LIQUIDITY]: TransactionState.PROCESSING,
  [BuyCryptoStatus.PREPARED]: TransactionState.PROCESSING,
  [BuyCryptoStatus.PRICE_MISMATCH]: TransactionState.PROCESSING,
  [BuyCryptoStatus.PRICE_SLIPPAGE]: TransactionState.PROCESSING,
  [BuyCryptoStatus.READY_FOR_PAYOUT]: TransactionState.PROCESSING,
  [BuyCryptoStatus.COMPLETE]: TransactionState.COMPLETED,
  [BuyCryptoStatus.WAITING_FOR_LOWER_FEE]: TransactionState.FEE_TOO_HIGH,
};

export const RefRewardStatusMapper: {
  [key in RewardStatus]: TransactionState;
} = {
  [RewardStatus.CREATED]: TransactionState.CREATED,
  [RewardStatus.PREPARED]: TransactionState.CREATED,
  [RewardStatus.PENDING_LIQUIDITY]: TransactionState.PROCESSING,
  [RewardStatus.READY_FOR_PAYOUT]: TransactionState.PROCESSING,
  [RewardStatus.PAYING_OUT]: TransactionState.PROCESSING,
  [RewardStatus.COMPLETE]: TransactionState.COMPLETED,
};

export function getStatus(entity: BuyFiat | BuyCrypto | RefReward): TransactionState {
  if (entity instanceof RefReward) {
    return RefRewardStatusMapper[entity.status];
  }

  if (entity instanceof BuyCrypto) {
    if (entity.chargebackDate) return TransactionState.RETURNED;
    if (entity.status && entity.amlCheck === CheckStatus.PASS) return BuyCryptoStatusMapper[entity.status];
  }

  if (entity instanceof BuyFiat) {
    if (entity.cryptoReturnDate) return TransactionState.RETURNED;
  }

  switch (entity.amlCheck) {
    case CheckStatus.FAIL:
      return TransactionState.FAILED;

    case CheckStatus.PENDING:
      return TransactionState.AML_PENDING;

    case CheckStatus.PASS:
      if (entity.isComplete) return TransactionState.COMPLETED;
      break;
  }

  if (entity.outputReferenceAsset) return TransactionState.PROCESSING;

  return TransactionState.CREATED;
}
