import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { BuyCrypto } from '../../buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from '../../referral/reward/ref-reward.entity';
import { BuyFiat } from '../../sell-crypto/process/buy-fiat.entity';
import { CompactHistoryDto, getStatus } from '../dto/output/compact-history.dto';
import { TransactionType } from '../dto/transaction/transaction.dto';

export class CompactHistoryDtoMapper {
  static mapBuyCryptoTransactions(buyCryptos: BuyCrypto[]): CompactHistoryDto[] {
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

  static mapBuyFiatTransactions(buyFiats: BuyFiat[]): CompactHistoryDto[] {
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

  static mapReferralRewards(refRewards: RefReward[]): CompactHistoryDto[] {
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
