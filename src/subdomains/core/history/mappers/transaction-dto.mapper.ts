import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { Active, amountType, feeAmountType, isAsset } from 'src/shared/models/active';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { AmountType, Util } from 'src/shared/utils/util';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import {
  KycRequiredReason,
  LimitExceededReason,
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
import { Buy } from '../../buy-crypto/routes/buy/buy.entity';
import { Swap } from '../../buy-crypto/routes/swap/swap.entity';
import { RefReward, RewardStatus } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';

export class BuyCryptoExtended extends BuyCrypto {
  inputAssetEntity: Active;
  inputReferenceAssetEntity: Active;
}

export class BuyFiatExtended extends BuyFiat {
  inputAssetEntity: Active;
  inputReferenceAssetEntity: Active;
}

export class TransactionRequestExtended extends TransactionRequest {
  route: Buy | Sell | Swap;
  sourceAssetEntity: Active;
  targetAssetEntity: Active;
}

export class TransactionDtoMapper {
  // BuyCrypto
  static mapBuyCryptoTransaction(buyCrypto: BuyCryptoExtended): TransactionDto {
    const dto: TransactionDto = {
      id: buyCrypto.transaction.id,
      uid: buyCrypto.transaction.uid,
      orderUid: buyCrypto.transaction.request?.uid,
      type: buyCrypto.isCryptoCryptoTransaction ? TransactionType.SWAP : TransactionType.BUY,
      ...getTransactionStateDetails(buyCrypto),
      inputAmount: Util.roundReadable(buyCrypto.inputAmount, amountType(buyCrypto.inputAssetEntity)),
      inputAsset: buyCrypto.inputAssetEntity.name,
      inputAssetId: buyCrypto.inputAssetEntity.id,
      inputBlockchain: buyCrypto.cryptoInput?.asset.blockchain,
      inputPaymentMethod: buyCrypto.paymentMethodIn,
      ...(buyCrypto.outputAmount ? buyCrypto.exchangeRate : null),
      outputAmount:
        buyCrypto.outputAmount != null ? Util.roundReadable(buyCrypto.outputAmount, AmountType.ASSET) : null,
      outputAsset: buyCrypto.outputAsset?.name,
      outputAssetId: buyCrypto.outputAsset?.id,
      outputBlockchain: buyCrypto.outputAsset?.blockchain,
      outputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      priceSteps: buyCrypto.priceStepsObject,
      feeAmount: buyCrypto.totalFeeAmount
        ? Util.roundReadable(
            buyCrypto.totalFeeAmount * (buyCrypto.inputAmount / buyCrypto.inputReferenceAmount),
            feeAmountType(buyCrypto.inputAssetEntity),
          )
        : null,
      feeAsset: buyCrypto.totalFeeAmount ? buyCrypto.inputAssetEntity.name : null,
      fees: TransactionDtoMapper.mapFees(buyCrypto),
      inputTxId: buyCrypto.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyCrypto?.cryptoInput
        ? txExplorerUrl(buyCrypto.cryptoInput.asset.blockchain, buyCrypto.cryptoInput.inTxId)
        : null,
      outputTxId: buyCrypto.txId,
      outputTxUrl: buyCrypto.txId ? txExplorerUrl(buyCrypto.outputAsset?.blockchain, buyCrypto.txId) : null,
      outputDate: buyCrypto.outputDate,
      chargebackAmount: buyCrypto.chargebackAmount,
      chargebackAsset: buyCrypto.inputReferenceAssetEntity.name,
      chargebackAssetId: buyCrypto.inputReferenceAssetEntity.id,
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

  // BuyFiat
  static mapBuyFiatTransaction(buyFiat: BuyFiatExtended): TransactionDto {
    const dto: TransactionDto = {
      id: buyFiat.transaction.id,
      uid: buyFiat.transaction.uid,
      orderUid: buyFiat.transaction.request?.uid,
      type: TransactionType.SELL,
      ...getTransactionStateDetails(buyFiat),
      inputAmount: Util.roundReadable(buyFiat.inputAmount, amountType(buyFiat.inputAssetEntity)),
      inputAsset: buyFiat.inputAssetEntity.name,
      inputAssetId: buyFiat.inputAssetEntity.id,
      inputBlockchain: buyFiat.cryptoInput?.asset.blockchain,
      inputPaymentMethod: CryptoPaymentMethod.CRYPTO,
      ...(buyFiat.outputAmount ? buyFiat.exchangeRate : null),
      outputAmount: buyFiat.outputAmount != null ? Util.roundReadable(buyFiat.outputAmount, AmountType.FIAT) : null,
      outputAsset: buyFiat.outputAsset?.name,
      outputAssetId: buyFiat.outputAsset?.id,
      outputBlockchain: null,
      outputPaymentMethod: FiatPaymentMethod.BANK,
      outputDate: buyFiat.outputDate,
      priceSteps: buyFiat.priceStepsObject,
      feeAmount: buyFiat.totalFeeAmount
        ? Util.roundReadable(
            buyFiat.totalFeeAmount * (buyFiat.inputAmount / buyFiat.inputReferenceAmount),
            feeAmountType(buyFiat.inputAssetEntity),
          )
        : null,
      feeAsset: buyFiat.totalFeeAmount ? buyFiat.inputAssetEntity.name : null,
      fees: TransactionDtoMapper.mapFees(buyFiat),
      inputTxId: buyFiat.cryptoInput?.inTxId ?? null,
      inputTxUrl: buyFiat?.cryptoInput
        ? txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId)
        : null,
      outputTxId: buyFiat.bankTx?.remittanceInfo ?? null,
      outputTxUrl: null,
      chargebackAmount: buyFiat.chargebackAmount,
      chargebackAsset: buyFiat.inputReferenceAssetEntity.name,
      chargebackAssetId: buyFiat.inputReferenceAssetEntity.id,
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

  // Waiting TxRequest
  static mapTxRequestTransaction(txRequest: TransactionRequestExtended): TransactionDto {
    const fees = TransactionDtoMapper.mapFees(txRequest);

    const dto: TransactionDto = {
      id: null,
      uid: txRequest.uid,
      type: Object.values(TransactionType).find((t) => t === txRequest.type.toString()),
      ...getTransactionStateDetails(txRequest),
      inputAmount: Util.roundReadable(txRequest.amount, amountType(txRequest.sourceAssetEntity)),
      inputAsset: txRequest.sourceAssetEntity.name,
      inputAssetId: txRequest.sourceAssetEntity.id,
      inputBlockchain: isAsset(txRequest.sourceAssetEntity) ? txRequest.sourceAssetEntity.blockchain : null,
      inputPaymentMethod: txRequest.sourcePaymentMethod,
      outputAmount: null,
      outputAsset: txRequest.targetAssetEntity?.name,
      outputAssetId: txRequest.targetAssetEntity?.id,
      outputBlockchain: isAsset(txRequest.targetAssetEntity) ? txRequest.targetAssetEntity?.blockchain : null,
      outputPaymentMethod: txRequest.targetPaymentMethod,
      priceSteps: null,
      feeAmount: fees?.total,
      feeAsset: fees?.total ? txRequest.sourceAssetEntity.name : null,
      fees,
      inputTxId: null,
      inputTxUrl: null,
      outputTxId: null,
      outputTxUrl: null,
      outputDate: null,
      chargebackAmount: null,
      chargebackTarget: null,
      chargebackTxId: null,
      chargebackTxUrl: null,
      chargebackDate: null,
      date: txRequest.created,
      externalTransactionId: null,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapTxRequestTransactionDetail(txRequest: TransactionRequestExtended): TransactionDetailDto {
    return {
      ...this.mapTxRequestTransaction(txRequest),
      sourceAccount: null,
      targetAccount: txRequest.route.targetAccount,
    };
  }

  static mapTxRequestTransactions(txRequests: TransactionRequestExtended[]): TransactionDto[] {
    return txRequests.map(TransactionDtoMapper.mapTxRequestTransaction);
  }

  // RefReward
  static mapReferralReward(refReward: RefReward): TransactionDto {
    const dto: TransactionDto = {
      id: refReward.transaction.id,
      uid: refReward.transaction.uid,
      orderUid: null,
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
          ? Util.roundReadable(refReward.outputAmount, amountType(refReward.outputAsset))
          : null,
      outputAsset: refReward.outputAsset.name,
      outputAssetId: refReward.outputAsset?.id,
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
      chargebackAsset: undefined,
      chargebackAssetId: undefined,
      chargebackTarget: undefined,
      chargebackTxId: undefined,
      chargebackTxUrl: undefined,
      chargebackDate: undefined,
      date: refReward.transaction.created,
    };

    return Object.assign(new TransactionDto(), dto);
  }

  static mapReferralRewardDetail(refReward: RefReward): TransactionDetailDto {
    return {
      ...this.mapReferralReward(refReward),
      sourceAccount: null,
      targetAccount: refReward.user?.address,
    };
  }

  static mapReferralRewards(refRewards: RefReward[]): TransactionDto[] {
    return refRewards.map(TransactionDtoMapper.mapReferralReward);
  }

  // UnassignedTx
  static mapUnassignedTransaction(tx: BankTx, currency: Fiat, bankTxReturn?: BankTxReturn): UnassignedTransactionDto {
    return {
      id: tx.transaction.id,
      uid: tx.transaction.uid,
      orderUid: tx.transaction.request?.uid,
      type: TransactionType.BUY,
      state: bankTxReturn?.chargebackDate
        ? TransactionState.RETURNED
        : bankTxReturn?.chargebackAllowedDateUser
        ? TransactionState.RETURN_PENDING
        : TransactionState.UNASSIGNED,
      inputAmount: tx.txAmount,
      inputAsset: tx.txCurrency,
      inputAssetId: currency.id,
      inputBlockchain: null,
      inputPaymentMethod: FiatPaymentMethod.BANK,
      inputTxId: null,
      inputTxUrl: null,
      chargebackAmount: bankTxReturn?.chargebackAmount,
      chargebackTarget: bankTxReturn?.chargebackIban,
      chargebackTxId: bankTxReturn?.chargebackRemittanceInfo,
      chargebackTxUrl: undefined,
      chargebackDate: bankTxReturn?.chargebackDate,
      date: tx.transaction.created,
    };
  }

  // Fees
  private static mapFees(entity: BuyCryptoExtended | BuyFiatExtended | TransactionRequestExtended): FeeDto {
    // TODO wait for guaranteed prices PR
    if (entity instanceof TransactionRequestExtended) return null;

    if (entity.percentFee == null) return null;

    const referencePrice = entity.inputAmount / entity.inputReferenceAmount;
    const networkStartFee = (entity instanceof BuyCrypto && entity.networkStartFeeAmount) || 0;
    const blockchainFee = entity.blockchainFee ?? 0;

    return {
      rate: entity.percentFee,
      bank:
        entity.bankFeeAmount != null
          ? Util.roundReadable(entity.bankFeeAmount * referencePrice, feeAmountType(entity.inputAssetEntity))
          : null,
      fixed:
        entity.absoluteFeeAmount != null
          ? Util.roundReadable(entity.absoluteFeeAmount * referencePrice, feeAmountType(entity.inputAssetEntity))
          : null,
      min:
        entity.minFeeAmount != null
          ? Util.roundReadable(entity.minFeeAmount * referencePrice, feeAmountType(entity.inputAssetEntity))
          : null,
      network: Util.roundReadable(blockchainFee * referencePrice, feeAmountType(entity.inputAssetEntity)),
      dfx:
        entity.totalFeeAmount != null
          ? Util.roundReadable(
              (entity.totalFeeAmount - (blockchainFee + networkStartFee)) * referencePrice,
              feeAmountType(entity.inputAssetEntity),
            )
          : null,
      total:
        entity.totalFeeAmount != null
          ? Util.roundReadable(entity.totalFeeAmount * referencePrice, feeAmountType(entity.inputAssetEntity))
          : null,
      networkStart: Util.roundReadable(networkStartFee * referencePrice, feeAmountType(entity.inputAssetEntity)),
    };
  }
}

export const RefRewardStatusMapper: {
  [key in RewardStatus]: TransactionState;
} = {
  [RewardStatus.CREATED]: TransactionState.CREATED,
  [RewardStatus.PREPARED]: TransactionState.CREATED,
  [RewardStatus.MANUAL_CHECK]: TransactionState.PROCESSING,
  [RewardStatus.PENDING_LIQUIDITY]: TransactionState.LIQUIDITY_PENDING,
  [RewardStatus.READY_FOR_PAYOUT]: TransactionState.PAYOUT_IN_PROGRESS,
  [RewardStatus.PAYING_OUT]: TransactionState.PAYOUT_IN_PROGRESS,
  [RewardStatus.FAILED]: TransactionState.FAILED,
  [RewardStatus.COMPLETE]: TransactionState.COMPLETED,
  [RewardStatus.USER_SWITCH]: TransactionState.FAILED,
};

function getTransactionStateDetails(entity: BuyFiat | BuyCrypto | RefReward | TransactionRequest): {
  state: TransactionState;
  reason: TransactionReason;
  chargebackTxId?: string;
} {
  if (entity instanceof TransactionRequest) {
    return { state: TransactionState.WAITING_FOR_PAYMENT, reason: null };
  }

  if (entity instanceof RefReward) {
    return { state: RefRewardStatusMapper[entity.status], reason: null };
  }

  const reason = entity.amlReason
    ? TransactionReasonMapper[entity.amlReason]
    : entity.cryptoInput && !entity.cryptoInput.isSettled
    ? TransactionReason.INPUT_NOT_CONFIRMED
    : null;

  if (entity instanceof BuyCrypto) {
    switch (entity.amlCheck) {
      case null:
        if (entity.comment != null) return { state: TransactionState.PROCESSING, reason };
        return { state: TransactionState.CREATED, reason };

      case CheckStatus.PENDING:
      case CheckStatus.GSHEET:
        if (LimitExceededReason.includes(reason)) return { state: TransactionState.LIMIT_EXCEEDED, reason };
        if (KycRequiredReason.includes(reason)) return { state: TransactionState.KYC_REQUIRED, reason };
        return { state: TransactionState.CHECK_PENDING, reason };

      case CheckStatus.FAIL:
        if (
          entity.chargebackDate &&
          (entity.chargebackCryptoTxId || entity.checkoutTx || entity.chargebackOutput?.isTransmittedDate)
        )
          return { state: TransactionState.RETURNED, reason };
        if (entity.chargebackAllowedDateUser || entity.chargebackAllowedDate)
          return { state: TransactionState.RETURN_PENDING, reason };
        return {
          state: TransactionState.FAILED,
          reason,
          chargebackTxId: entity.chargebackCryptoTxId ?? entity.chargebackRemittanceInfo,
        };

      case CheckStatus.PASS:
        if (entity.isComplete) return { state: TransactionState.COMPLETED, reason: null };
        if (entity.status === BuyCryptoStatus.WAITING_FOR_LOWER_FEE)
          return { state: TransactionState.FEE_TOO_HIGH, reason: null };
        if ([BuyCryptoStatus.MISSING_LIQUIDITY, BuyCryptoStatus.PENDING_LIQUIDITY].includes(entity.status))
          return { state: TransactionState.LIQUIDITY_PENDING, reason: null };
        if ([BuyCryptoStatus.PRICE_INVALID, BuyCryptoStatus.PRICE_SLIPPAGE].includes(entity.status))
          return { state: TransactionState.PRICE_UNDETERMINABLE, reason: null };
        if (
          [BuyCryptoStatus.BATCHED, BuyCryptoStatus.READY_FOR_PAYOUT, BuyCryptoStatus.PAYING_OUT].includes(
            entity.status,
          )
        )
          return { state: TransactionState.PAYOUT_IN_PROGRESS, reason: null };
        break;
    }

    return { state: TransactionState.PROCESSING, reason };
  }

  if (entity instanceof BuyFiat) {
    switch (entity.amlCheck) {
      case null:
        if (entity.comment != null) return { state: TransactionState.PROCESSING, reason };
        return { state: TransactionState.CREATED, reason };

      case CheckStatus.PENDING:
      case CheckStatus.GSHEET:
        if (LimitExceededReason.includes(reason)) return { state: TransactionState.LIMIT_EXCEEDED, reason };
        if (KycRequiredReason.includes(reason)) return { state: TransactionState.KYC_REQUIRED, reason };
        return { state: TransactionState.CHECK_PENDING, reason };

      case CheckStatus.FAIL:
        if (entity.chargebackDate && entity.chargebackTxId) return { state: TransactionState.RETURNED, reason };
        if (entity.chargebackAllowedDateUser) return { state: TransactionState.RETURN_PENDING, reason };
        return { state: TransactionState.FAILED, reason, chargebackTxId: entity.chargebackTxId };

      case CheckStatus.PASS:
        if (entity.isComplete) return { state: TransactionState.COMPLETED, reason: null };
        if (entity.fiatOutput) return { state: TransactionState.PAYOUT_IN_PROGRESS, reason: null };

        break;
    }

    return { state: TransactionState.PROCESSING, reason };
  }
}
