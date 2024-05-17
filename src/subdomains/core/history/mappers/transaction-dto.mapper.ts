import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Active, isFiat } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.entity';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  KycRequiredReason,
  TransactionDetailDto,
  TransactionDto,
  TransactionReason,
  TransactionReasonMapper,
  TransactionState,
  TransactionType,
  UnassignedTransactionDto,
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
      uid: buyCrypto.transaction?.uid,
      type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.SWAP : TransactionType.BUY,
      ...getTransactionStateDetails(buyCrypto),
      inputAmount: Util.roundReadable(buyCrypto.inputAmount, isFiat(buyCrypto.inputAssetEntity)),
      inputAsset: buyCrypto.inputAsset,
      inputAssetId: buyCrypto.inputAssetEntity.id,
      inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
      inputPaymentMethod: buyCrypto.paymentMethodIn,
      ...(buyCrypto.outputAmount ? buyCrypto.exchangeRate : null),
      outputAmount: Util.roundReadable(buyCrypto.outputAmount, false),
      outputAsset: buyCrypto.outputAsset?.name,
      outputAssetId: buyCrypto.outputAsset?.id,
      outputBlockchain: buyCrypto.target.asset.blockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      feeAmount: buyCrypto.totalFeeAmount
        ? Util.roundReadable(
            buyCrypto.totalFeeAmount * (buyCrypto.inputAmount / buyCrypto.inputReferenceAmount),
            isFiat(buyCrypto.inputAssetEntity),
          )
        : null,
      feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAsset : null,
      fees: TransactionDtoMapper.mapFees(buyCrypto),
      inputTxId: buyCrypto.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyCrypto?.cryptoInput
        ? txExplorerUrl(buyCrypto.cryptoInput.asset.blockchain, buyCrypto.cryptoInput.inTxId)
        : null,
      outputTxId: buyCrypto.txId,
      outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId) : null,
      date: buyCrypto.outputDate ?? buyCrypto.chargebackDate ?? buyCrypto.updated,
      externalTransactionId: buyCrypto.externalTransactionId,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyCryptoTransactionDetail(buyCrypto: BuyCryptoExtended): TransactionDetailDto {
    return {
      ...this.mapBuyCryptoTransaction(buyCrypto),
      sourceAccount: buyCrypto.bankTx?.iban,
      targetAccount: buyCrypto.user?.address,
    };
  }

  static mapBuyCryptoTransactions(buyCryptos: BuyCryptoExtended[]): TransactionDto[] {
    return buyCryptos.map(TransactionDtoMapper.mapBuyCryptoTransaction);
  }

  static mapBuyFiatTransaction(buyFiat: BuyFiatExtended): TransactionDto {
    const dto: TransactionDto = {
      id: buyFiat.transaction?.id,
      uid: buyFiat.transaction?.uid,
      type: TransactionType.SELL,
      ...getTransactionStateDetails(buyFiat),
      inputAmount: Util.roundReadable(buyFiat.inputAmount, isFiat(buyFiat.inputAssetEntity)),
      inputAsset: buyFiat.inputAsset,
      inputAssetId: buyFiat.inputAssetEntity.id,
      inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      ...(buyFiat.outputAmount ? buyFiat.exchangeRate : null),
      outputAmount: Util.roundReadable(buyFiat.outputAmount, true),
      outputAsset: buyFiat.outputAsset?.name,
      outputAssetId: buyFiat.outputAsset?.id,
      outputBlockchain: null,
      outputPaymentMethod: FiatPaymentMethod.BANK,
      feeAmount: buyFiat.totalFeeAmount
        ? Util.roundReadable(
            buyFiat.totalFeeAmount * (buyFiat.inputAmount / buyFiat.inputReferenceAmount),
            isFiat(buyFiat.inputAssetEntity),
          )
        : null,
      feeAsset: buyFiat.totalFeeAmount ? buyFiat.inputAsset : null,
      fees: TransactionDtoMapper.mapFees(buyFiat),
      inputTxId: buyFiat.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyFiat?.cryptoInput
        ? txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId)
        : null,
      outputTxId: buyFiat.bankTx?.remittanceInfo ?? null,
      outputTxUrl: null,
      date: buyFiat.outputDate ?? buyFiat.cryptoReturnDate ?? buyFiat.updated,
      externalTransactionId: buyFiat.externalTransactionId,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapBuyFiatTransactionDetail(buyFiat: BuyFiatExtended): TransactionDetailDto {
    return {
      ...this.mapBuyFiatTransaction(buyFiat),
      sourceAccount: null,
      targetAccount: buyFiat.bankTx?.iban,
    };
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiatExtended[]): TransactionDto[] {
    return buyFiats.map(TransactionDtoMapper.mapBuyFiatTransaction);
  }

  static mapReferralReward(refReward: RefRewardExtended): TransactionDto {
    const dto: TransactionDto = {
      id: refReward.transaction?.id,
      uid: refReward.transaction?.uid,
      type: TransactionType.REFERRAL,
      ...getTransactionStateDetails(refReward),
      inputAmount: null,
      inputAsset: null,
      inputAssetId: null,
      inputBlockchain: null,
      inputPaymentMethod: null,
      exchangeRate: null,
      rate: null,
      outputAmount: Util.roundReadable(refReward.outputAmount, isFiat(refReward.outputAssetEntity)),
      outputAsset: refReward.outputAsset,
      outputAssetId: refReward.outputAssetEntity?.id,
      outputBlockchain: refReward.targetBlockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      feeAmount: null,
      feeAsset: null,
      fees: null,
      inputTxId: null,
      inputTxUrl: null,
      outputTxId: refReward.txId,
      outputTxUrl: refReward.txId ? txExplorerUrl(refReward.targetBlockchain, refReward.txId) : null,
      date: refReward.outputDate ?? refReward.updated,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapReferralRewardDetail(refReward: RefRewardExtended): TransactionDetailDto {
    return {
      ...this.mapReferralReward(refReward),
      sourceAccount: null,
      targetAccount: refReward.user?.address,
    };
  }

  static mapReferralRewards(refRewards: RefRewardExtended[]): TransactionDto[] {
    return refRewards.map(TransactionDtoMapper.mapReferralReward);
  }

  static mapUnassignedTransaction(tx: BankTx, currency: Fiat): UnassignedTransactionDto {
    return {
      id: tx.transaction?.id,
      uid: tx.transaction?.uid,
      type: TransactionType.BUY,
      state: TransactionState.UNASSIGNED,
      inputAmount: tx.txAmount,
      inputAsset: tx.txCurrency,
      inputAssetId: currency.id,
      inputBlockchain: null,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      inputTxId: null,
      inputTxUrl: null,
      date: tx.created,
    };
  }

  private static mapFees(entity: BuyCryptoExtended | BuyFiatExtended): FeeDto {
    const referencePrice = entity.inputAmount / entity.inputReferenceAmount;

    if (entity.percentFee == null) return null;

    return {
      rate: entity.percentFee,
      fixed:
        entity.absoluteFeeAmount != null
          ? Util.roundReadable(entity.absoluteFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      min:
        entity.minFeeAmount != null
          ? Util.roundReadable(entity.minFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      network:
        entity.blockchainFee != null
          ? Util.roundReadable(entity.blockchainFee * referencePrice, isFiat(entity.inputAssetEntity))
          : 0,
      dfx:
        entity.totalFeeAmount != null
          ? Util.roundReadable(
              (entity.totalFeeAmount - (entity.blockchainFee ?? 0)) * referencePrice,
              isFiat(entity.inputAssetEntity),
            )
          : null,
      total:
        entity.totalFeeAmount != null
          ? Util.roundReadable(entity.totalFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
    };
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
        return { state: TransactionState.CREATED, reason };

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
        return { state: TransactionState.CREATED, reason };

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
