import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { BuyCrypto, BuyCryptoStatus } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';
import { RefReward, RewardStatus } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { TransactionDto } from '../dto/output/transaction.dto';
import { TransactionState, TransactionType } from '../dto/transaction/transaction.dto';

export class TransactionDtoMapper {
  static mapBuyCryptoTransactions(buyCryptos: BuyCrypto[]): TransactionDto[] {
    return buyCryptos
      .map((buyCrypto) => [
        {
          type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.CONVERT : TransactionType.BUY,
          state: getStatus(buyCrypto),
          inputAmount: buyCrypto.inputAmount,
          inputAsset: buyCrypto.inputAsset,
          inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
          outputAmount: buyCrypto.outputAmount,
          outputAsset: buyCrypto.outputAsset?.name,
          outputBlockchain: buyCrypto.target.asset.blockchain,
          feeAmount: buyCrypto.percentFee,
          feeAsset: buyCrypto.percentFee ? buyCrypto.inputReferenceAsset : null,
          txId: buyCrypto.txId,
          txUrl: txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId),
          date: buyCrypto.outputDate,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): TransactionDto[] {
    return buyFiats
      .map((buyFiat) => [
        {
          type: TransactionType.SELL,
          state: getStatus(buyFiat),
          inputAmount: buyFiat.inputAmount,
          inputAsset: buyFiat.inputAsset,
          inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
          outputAmount: buyFiat.outputAmount,
          outputAsset: buyFiat.outputAsset,
          outputBlockchain: null,
          feeAmount: buyFiat.percentFee,
          feeAsset: buyFiat.percentFee ? buyFiat.inputReferenceAsset : null,
          txId: buyFiat.fiatOutput?.remittanceInfo,
          txUrl: null,
          date: buyFiat.outputDate,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapReferralRewards(refRewards: RefReward[]): TransactionDto[] {
    return refRewards
      .map((refReward) => [
        {
          type: TransactionType.REFERRAL,
          state: getStatus(refReward),
          inputAmount: null,
          inputAsset: null,
          inputBlockchain: null,
          outputAmount: refReward.outputAmount,
          outputAsset: refReward.outputAsset,
          outputBlockchain: refReward.targetBlockchain,
          feeAmount: null,
          feeAsset: null,
          txId: refReward.txId,
          txUrl: txExplorerUrl(refReward.targetBlockchain, refReward.txId),
          date: refReward.outputDate,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }
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
