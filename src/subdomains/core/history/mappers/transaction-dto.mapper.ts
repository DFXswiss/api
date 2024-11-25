import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Active, isFiat } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
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
      id: buyCrypto.transaction.id,
      uid: buyCrypto.transaction.uid,
      type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.SWAP : TransactionType.BUY,
      ...getTransactionStateDetails(buyCrypto),
      inputAmount: Util.roundReadable(buyCrypto.inputAmount, isFiat(buyCrypto.inputAssetEntity)),
      inputAsset: buyCrypto.inputAsset,
      inputAssetId: buyCrypto.inputAssetEntity.id,
      inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
      inputPaymentMethod: buyCrypto.paymentMethodIn,
      ...(buyCrypto.outputAmount ? buyCrypto.exchangeRate : null),
      outputAmount: buyCrypto.outputAmount != null ? Util.roundReadable(buyCrypto.outputAmount, false) : null,
      outputAsset: buyCrypto.outputAsset?.name,
      outputAssetId: buyCrypto.outputAsset?.id,
      outputBlockchain: buyCrypto.outputAsset?.blockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      priceSteps: buyCrypto.priceStepsObject,
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
      outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.outputAsset?.blockchain, buyCrypto.txId) : null,
      outputDate: buyCrypto.outputDate,
      chargebackAmount: buyCrypto.chargebackAmount,
      chargebackTarget: buyCrypto.chargebackIban,
      chargebackTxId: buyCrypto.chargebackRemittanceInfo ?? buyCrypto.chargebackCryptoTxId,
      chargebackTxUrl:
        buyCrypto.chargebackCryptoTxId && buyCrypto.cryptoInput
          ? txExplorerUrl(buyCrypto.cryptoInput.asset.blockchain, buyCrypto.chargebackCryptoTxId)
          : null,
      chargebackDate: buyCrypto.chargebackDate,
      date: buyCrypto.transaction.created,
      externalTransactionId: buyCrypto.transaction.externalId,
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
      id: buyFiat.transaction.id,
      uid: buyFiat.transaction.uid,
      type: TransactionType.SELL,
      ...getTransactionStateDetails(buyFiat),
      inputAmount: Util.roundReadable(buyFiat.inputAmount, isFiat(buyFiat.inputAssetEntity)),
      inputAsset: buyFiat.inputAsset,
      inputAssetId: buyFiat.inputAssetEntity.id,
      inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      ...(buyFiat.outputAmount ? buyFiat.exchangeRate : null),
      outputAmount: buyFiat.outputAmount != null ? Util.roundReadable(buyFiat.outputAmount, true) : null,
      outputAsset: buyFiat.outputAsset?.name,
      outputAssetId: buyFiat.outputAsset?.id,
      outputBlockchain: null,
      outputPaymentMethod: FiatPaymentMethod.BANK,
      outputDate: buyFiat.outputDate,
      priceSteps: buyFiat.priceStepsObject,
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
      chargebackAmount: buyFiat.chargebackAmount,
      chargebackTarget: buyFiat.chargebackAddress,
      chargebackTxId: buyFiat.chargebackTxId,
      chargebackTxUrl: buyFiat.chargebackTxId
        ? txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.chargebackTxId)
        : null,
      chargebackDate: buyFiat.chargebackDate,
      date: buyFiat.transaction.created,
      externalTransactionId: buyFiat.transaction.externalId,
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
      id: refReward.transaction.id,
      uid: refReward.transaction.uid,
      type: TransactionType.REFERRAL,
      ...getTransactionStateDetails(refReward),
      inputAmount: null,
      inputAsset: null,
      inputAssetId: null,
      inputBlockchain: null,
      inputPaymentMethod: null,
      exchangeRate: null,
      rate: null,
      outputAmount:
        refReward.outputAmount != null
          ? Util.roundReadable(refReward.outputAmount, isFiat(refReward.outputAssetEntity))
          : null,
      outputAsset: refReward.outputAsset,
      outputAssetId: refReward.outputAssetEntity?.id,
      outputBlockchain: refReward.targetBlockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      outputDate: refReward.outputDate,
      priceSteps: null,
      feeAmount: null,
      feeAsset: null,
      fees: null,
      inputTxId: null,
      inputTxUrl: null,
      outputTxId: refReward.txId,
      outputTxUrl: refReward.txId ? txExplorerUrl(refReward.targetBlockchain, refReward.txId) : null,
      chargebackAmount: undefined,
      chargebackTarget: undefined,
      chargebackTxId: undefined,
      chargebackTxUrl: undefined,
      chargebackDate: undefined,
      date: refReward.transaction.created,
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
      id: tx.transaction.id,
      uid: tx.transaction.uid,
      type: TransactionType.BUY,
      state: TransactionState.UNASSIGNED,
      inputAmount: tx.txAmount,
      inputAsset: tx.txCurrency,
      inputAssetId: currency.id,
      inputBlockchain: null,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      inputTxId: null,
      inputTxUrl: null,
      chargebackAmount: undefined,
      chargebackTarget: undefined,
      chargebackTxId: undefined,
      chargebackTxUrl: undefined,
      chargebackDate: undefined,
      date: tx.transaction.created,
    };
  }

  private static mapFees(entity: BuyCryptoExtended | BuyFiatExtended): FeeDto {
    if (entity.percentFee == null) return null;

    const referencePrice = entity.inputAmount / entity.inputReferenceAmount;
    const networkStartFee = (entity instanceof BuyCrypto && entity.networkStartFeeAmount) || 0;
    const blockchainFee = entity.blockchainFee ?? 0;

    return {
      rate: entity.percentFee,
      bank:
        entity.bankFeeAmount != null
          ? Util.roundReadable(entity.bankFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      fixed:
        entity.absoluteFeeAmount != null
          ? Util.roundReadable(entity.absoluteFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      min:
        entity.minFeeAmount != null
          ? Util.roundReadable(entity.minFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      network: Util.roundReadable(blockchainFee * referencePrice, isFiat(entity.inputAssetEntity)),
      dfx:
        entity.totalFeeAmount != null
          ? Util.roundReadable(
              (entity.totalFeeAmount - (blockchainFee + networkStartFee)) * referencePrice,
              isFiat(entity.inputAssetEntity),
            )
          : null,
      total:
        entity.totalFeeAmount != null
          ? Util.roundReadable(entity.totalFeeAmount * referencePrice, isFiat(entity.inputAssetEntity))
          : null,
      networkStart: Util.roundReadable(networkStartFee * referencePrice, isFiat(entity.inputAssetEntity)),
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
  chargebackTxId?: string;
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
        if (entity.chargebackAllowedDateUser) return { state: TransactionState.RETURN_PENDING, reason };
        return {
          state: TransactionState.FAILED,
          reason,
          chargebackTxId: entity.chargebackCryptoTxId ?? entity.chargebackRemittanceInfo,
        };

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
        if (entity.chargebackDate) return { state: TransactionState.RETURNED, reason };
        if (entity.chargebackAllowedDateUser) return { state: TransactionState.RETURN_PENDING, reason };
        return { state: TransactionState.FAILED, reason, chargebackTxId: entity.chargebackTxId };

      case CheckStatus.PASS:
        if (entity.isComplete) return { state: TransactionState.COMPLETED, reason };
        break;
    }

    return { state: TransactionState.PROCESSING, reason };
  }
}
