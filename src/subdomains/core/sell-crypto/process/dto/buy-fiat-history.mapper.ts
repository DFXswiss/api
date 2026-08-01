import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { PaymentStatus } from 'src/subdomains/core/history/dto/history.dto';
import { SellHistoryDto } from 'src/subdomains/core/sell-crypto/route/dto/sell-history.dto';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';

/**
 * The history entry `GET /sell/:id/history` answers with.
 *
 * Its own mapper so that the projection spec can drive the same mapping the endpoint
 * uses — see `BuyCryptoHistoryMapper` for the reasoning.
 *
 * Note that `cryptoInput` and `outputAsset` are read without a guard here: `cryptoInput` is a
 * non-nullable relation, and a row whose `outputAsset` is unset throws — which the projection
 * leaves as it is.
 */
export class BuyFiatHistoryMapper {
  static toDto(buyFiat: BuyFiat): SellHistoryDto {
    return {
      inputAmount: buyFiat.inputAmount,
      inputAsset: buyFiat.inputAsset,
      outputAmount: buyFiat.outputAmount,
      outputAsset: buyFiat.outputAsset.name,
      txId: buyFiat.cryptoInput.inTxId,
      txUrl: txExplorerUrl(buyFiat.cryptoInput.asset.blockchain, buyFiat.cryptoInput.inTxId),
      date: buyFiat.fiatOutput?.outputDate,
      amlCheck: buyFiat.amlCheck,
      isComplete: buyFiat.isComplete,
      status: buyFiat.isComplete ? PaymentStatus.COMPLETE : PaymentStatus.PENDING,
    };
  }
}
