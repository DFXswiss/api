import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { BuyCrypto, BuyCryptoStatus } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { CheckStatus } from '../../buy-crypto/process/enums/check-status.enum';
import { RefReward, RewardStatus } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { TransactionDto, TransactionState, TransactionType } from '../dto/output/transaction.dto';

export class TransactionDtoMapper {
  static mapBuyCryptoTransaction(buyCrypto: BuyCrypto): TransactionDto {
    const dto: TransactionDto = {
      type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.CONVERT : TransactionType.BUY,
      state: getTransactionState(buyCrypto),
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
      exchangeRate: buyCrypto.outputAmount ? buyCrypto.exchangeRateString : null,
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset?.name,
      outputBlockchain: buyCrypto.target.asset.blockchain,
      feeAmount: buyCrypto.totalFeeAmount
        ? (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount
        : null,
      feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
      inputTxId: buyCrypto?.cryptoInput ? buyCrypto.cryptoInput.inTxId : null,
      inputTxUrl: buyCrypto?.cryptoInput
        ? txExplorerUrl(buyCrypto.cryptoInput.asset.blockchain, buyCrypto.cryptoInput.inTxId)
        : null,
      outputTxId: buyCrypto.txId,
      outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId) : null,
      date: buyCrypto.outputDate,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyCryptoTransactions(buyCryptos: BuyCrypto[]): TransactionDto[] {
    return buyCryptos.map(TransactionDtoMapper.mapBuyCryptoTransaction);
  }

  static mapBuyFiatTransaction(buyFiat: BuyFiat): TransactionDto {
    const dto: TransactionDto = {
      type: TransactionType.SELL,
      state: getTransactionState(buyFiat),
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
      exchangeRate: buyFiat.outputAmount ? buyFiat.exchangeRateString : null,
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset,
      outputBlockchain: null,
      feeAmount: buyFiat.totalFeeAmount
        ? (buyFiat.totalFeeAmount / buyFiat.inputReferenceAmount) * buyFiat.inputAmount
        : null,
      feeAsset: buyFiat.totalFeeAmount ? buyFiat.inputAsset : null,
      inputTxId: buyFiat.cryptoInput.inTxId,
      inputTxUrl: txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId),
      outputTxId: buyFiat.fiatOutput?.remittanceInfo,
      outputTxUrl: null,
      date: buyFiat.outputDate,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): TransactionDto[] {
    return buyFiats.map(TransactionDtoMapper.mapBuyFiatTransaction);
  }

  static mapReferralReward(refReward: RefReward): TransactionDto {
    const dto: TransactionDto = {
      type: TransactionType.REFERRAL,
      state: getTransactionState(refReward),
      inputAmount: null,
      inputAsset: null,
      inputBlockchain: null,
      exchangeRate: null,
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
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapReferralRewards(refRewards: RefReward[]): TransactionDto[] {
    return refRewards.map(TransactionDtoMapper.mapReferralReward);
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

export function getTransactionState(entity: BuyFiat | BuyCrypto | RefReward): TransactionState {
  if (entity instanceof RefReward) {
    return RefRewardStatusMapper[entity.status];
  }

  if (entity instanceof BuyCrypto) {
    if (entity.chargebackDate) return TransactionState.RETURNED;

    switch (entity.amlCheck) {
      case CheckStatus.PENDING:
        return TransactionState.AML_PENDING;
      case CheckStatus.FAIL:
        return TransactionState.FAILED;
      case CheckStatus.PASS:
        if (entity.isComplete) return TransactionState.COMPLETED;
        if (entity.status === BuyCryptoStatus.WAITING_FOR_LOWER_FEE) return TransactionState.FEE_TOO_HIGH;
        break;
    }

    if (entity.outputReferenceAsset) return TransactionState.PROCESSING;

    return TransactionState.CREATED;
  }

  if (entity instanceof BuyFiat) {
    if (entity.cryptoReturnDate) return TransactionState.RETURNED;

    switch (entity.amlCheck) {
      case CheckStatus.PENDING:
        return TransactionState.AML_PENDING;
      case CheckStatus.FAIL:
        return TransactionState.FAILED;
      case CheckStatus.PASS:
        if (entity.isComplete) return TransactionState.COMPLETED;
        break;
    }

    if (entity.outputReferenceAsset) return TransactionState.PROCESSING;

    return TransactionState.CREATED;
  }
}
