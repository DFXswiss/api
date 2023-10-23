import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { CompactHistoryDto, CompactHistoryTransactionType, getStatus } from '../dto/output/compact-history.dto';

export class CompactHistoryDtoMapper {
  static mapBuyCryptoTransactions(buyCryptos: BuyCrypto[]): CompactHistoryDto[] {
    return buyCryptos
      .map((buyCrypto) => [
        {
          type: buyCrypto.isCryptoCryptoTransaction
            ? CompactHistoryTransactionType.CRYPTO
            : CompactHistoryTransactionType.BUY,
          inputAmount: buyCrypto.inputAmount,
          inputAsset: buyCrypto.inputAsset,
          outputAmount: buyCrypto.outputAmount,
          outputAsset: buyCrypto.outputAsset?.name,
          feeAmount: buyCrypto.percentFee,
          feeAsset: buyCrypto.percentFee ? buyCrypto.inputReferenceAsset : null,
          txId: buyCrypto.txId,
          txUrl: txExplorerUrl(buyCrypto.target.asset.blockchain, buyCrypto.txId),
          date: buyCrypto.outputDate,
          amlCheck: buyCrypto.amlCheck,
          status: getStatus(buyCrypto),
          amountInEur: buyCrypto.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): CompactHistoryDto[] {
    return buyFiats
      .map((buyFiat) => [
        {
          type: CompactHistoryTransactionType.SELL,
          inputAmount: buyFiat.inputAmount,
          inputAsset: buyFiat.inputAsset,
          outputAmount: buyFiat.outputAmount,
          outputAsset: buyFiat.outputAsset,
          feeAmount: buyFiat.percentFee,
          feeAsset: buyFiat.percentFee ? buyFiat.inputReferenceAsset : null,
          txId: buyFiat.fiatOutput?.remittanceInfo,
          txUrl: null,
          date: buyFiat.outputDate,
          amlCheck: buyFiat.amlCheck,
          status: getStatus(buyFiat),
          amountInEur: buyFiat.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }

  static mapReferralRewards(refRewards: RefReward[]): CompactHistoryDto[] {
    return refRewards
      .map((refReward) => [
        {
          type: CompactHistoryTransactionType.REFERRAL,
          inputAmount: null,
          inputAsset: null,
          outputAmount: refReward.outputAmount,
          outputAsset: refReward.outputAsset,
          feeAmount: null,
          feeAsset: null,
          txId: refReward.txId,
          txUrl: txExplorerUrl(refReward.targetBlockchain, refReward.txId),
          date: refReward.outputDate,
          amlCheck: null,
          status: getStatus(refReward),
          amountInEur: refReward.amountInEur,
        },
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((e) => e != null);
  }
}
