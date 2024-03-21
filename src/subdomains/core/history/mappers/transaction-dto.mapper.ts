import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Active } from 'src/shared/models/active';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  KycRequiredReason,
  TransactionDto,
  TransactionReason,
  TransactionReasonMapper,
  TransactionState,
  TransactionType,
} from '../../../supporting/payment/dto/transaction.dto';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { BuyCrypto, BuyCryptoStatus } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { RefReward, RewardStatus } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';

export class BuyCryptoExtended extends BuyCrypto {
  inputAssetEntity: Active;
}

export class BuyFiatExtended extends BuyFiat {
  inputAssetEntity: Active;
}

export class RefRewardExtended extends RefReward {
  outputAssetEntity: Active;
}

export class TransactionDtoMapper {
  static mapBuyCryptoTransaction(buyCrypto: BuyCryptoExtended): TransactionDto {
    const dto: TransactionDto = {
      id: buyCrypto.transaction?.id,
      type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.CONVERT : TransactionType.BUY,
      ...getTransactionStateDetails(buyCrypto),
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      inputAssetId: buyCrypto.inputAssetEntity.id,
      inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
      inputPaymentMethod: buyCrypto.paymentMethodIn,
      ...(buyCrypto.outputAmount ? buyCrypto.exchangeRate : null),
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset?.name,
      outputAssetId: buyCrypto.outputAsset?.id,
      outputBlockchain: buyCrypto.target.asset.blockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      feeAmount: buyCrypto.totalFeeAmount
        ? (buyCrypto.totalFeeAmount / buyCrypto.inputReferenceAmount) * buyCrypto.inputAmount
        : null,
      feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
      inputTxId: buyCrypto.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyCrypto?.cryptoInput
        ? txExplorerUrl(buyCrypto.cryptoInput.asset.blockchain, buyCrypto.cryptoInput.inTxId)
        : null,
      outputTxId: buyCrypto.txId,
      outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId) : null,
      date: buyCrypto.outputDate,
      externalTransactionId: buyCrypto.externalTransactionId,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyCryptoTransactions(buyCryptos: BuyCryptoExtended[]): TransactionDto[] {
    return buyCryptos.map(TransactionDtoMapper.mapBuyCryptoTransaction);
  }

  static mapBuyFiatTransaction(buyFiat: BuyFiatExtended): TransactionDto {
    const dto: TransactionDto = {
      id: buyFiat.transaction?.id,
      type: TransactionType.SELL,
      ...getTransactionStateDetails(buyFiat),
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      inputAssetId: buyFiat.inputAssetEntity.id,
      inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      ...(buyFiat.outputAmount ? buyFiat.exchangeRate : null),
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset?.name,
      outputAssetId: buyFiat.outputAsset?.id,
      outputBlockchain: null,
      outputPaymentMethod: FiatPaymentMethod.BANK,
      feeAmount: buyFiat.totalFeeAmount
        ? (buyFiat.totalFeeAmount / buyFiat.inputReferenceAmount) * buyFiat.inputAmount
        : null,
      feeAsset: buyFiat.totalFeeAmount ? buyFiat.inputAsset : null,
      inputTxId: buyFiat.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyFiat?.cryptoInput
        ? txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId)
        : null,
      outputTxId: buyFiat.fiatOutput?.remittanceInfo ?? null,
      outputTxUrl: null,
      date: buyFiat.outputDate,
      externalTransactionId: buyFiat.externalTransactionId,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiatExtended[]): TransactionDto[] {
    return buyFiats.map(TransactionDtoMapper.mapBuyFiatTransaction);
  }

  static mapReferralReward(refReward: RefRewardExtended): TransactionDto {
    const dto: TransactionDto = {
      id: refReward.transaction?.id,
      type: TransactionType.REFERRAL,
      ...getTransactionStateDetails(refReward),
      inputAmount: null,
      inputAsset: null,
      inputAssetId: null,
      inputBlockchain: null,
      inputPaymentMethod: null,
      exchangeRate: null,
      rate: null,
      outputAmount: refReward.outputAmount,
      outputAsset: refReward.outputAsset,
      outputAssetId: refReward.outputAssetEntity?.id,
      outputBlockchain: refReward.targetBlockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
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

  static mapReferralRewards(refRewards: RefRewardExtended[]): TransactionDto[] {
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

function getTransactionStateDetails(entity: BuyFiat | BuyCrypto | RefReward): {
  state: TransactionState;
  reason: TransactionReason;
} {
  if (entity instanceof RefReward) {
    return { state: RefRewardStatusMapper[entity.status], reason: null };
  }

  const reason = entity.amlReason ? TransactionReasonMapper[entity.amlReason] : null;

  if (entity instanceof BuyCrypto) {
    switch (entity.amlCheck) {
      case null:
      case CheckStatus.PENDING:
      case CheckStatus.GSHEET:
        if (KycRequiredReason.includes(reason)) return { state: TransactionState.KYC_REQUIRED, reason };
        return { state: TransactionState.AML_PENDING, reason };

      case CheckStatus.FAIL:
        if (entity.chargebackDate) return { state: TransactionState.RETURNED, reason };
        return { state: TransactionState.FAILED, reason };

      case CheckStatus.PASS:
        if (entity.isComplete) return { state: TransactionState.COMPLETED, reason };
        if (entity.status === BuyCryptoStatus.WAITING_FOR_LOWER_FEE)
          return { state: TransactionState.FEE_TOO_HIGH, reason };
        break;
    }

    return { state: TransactionState.PROCESSING, reason };
  }

  if (entity instanceof BuyFiat) {
    switch (entity.amlCheck) {
      case null:
      case CheckStatus.PENDING:
      case CheckStatus.GSHEET:
        if (KycRequiredReason.includes(reason)) return { state: TransactionState.KYC_REQUIRED, reason };
        return { state: TransactionState.AML_PENDING, reason };

      case CheckStatus.FAIL:
        if (entity.cryptoReturnDate) return { state: TransactionState.RETURNED, reason };
        return { state: TransactionState.FAILED, reason };

      case CheckStatus.PASS:
        if (entity.isComplete) return { state: TransactionState.COMPLETED, reason };
        break;
    }

    return { state: TransactionState.PROCESSING, reason };
  }
}
