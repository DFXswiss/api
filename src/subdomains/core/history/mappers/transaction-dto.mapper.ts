import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { RefReward, RewardStatus } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { BuyFiatService } from '../../sell-crypto/process/buy-fiat.service';
import { TransactionDto, TransactionState, TransactionType } from '../dto/output/transaction.dto';

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
          inputTxId: buyCrypto.bankTx.remittanceInfo,
          inputTxUrl: null,
          outputTxId: buyCrypto.txId,
          outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId) : null,
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
          inputTxId: buyFiat.cryptoInput.inTxId,
          inputTxUrl: txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId),
          outputTxId: buyFiat.fiatOutput?.remittanceInfo,
          outputTxUrl: null,
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
          inputTxId: null,
          inputTxUrl: null,
          outputTxId: refReward.txId,
          outputTxUrl: refReward.txId ? txExplorerUrl(refReward.targetBlockchain, refReward.txId) : null,
          date: refReward.outputDate,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }
}

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
    return BuyCryptoWebhookService.getWebhookState(entity);
  }

  if (entity instanceof BuyFiat) {
    return BuyFiatService.getWebhookState(entity);
  }
}
