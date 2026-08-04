import { txExplorerUrl } from 'src/integration/blockchain/shared/util/blockchain.util';
import { HistoryDtoDeprecated, PaymentStatusMapper } from 'src/subdomains/core/history/dto/history.dto';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';

/**
 * The history entry `GET /buy/:id/history` and `GET /swap/:id/history` answer with.
 *
 * Its own mapper so that the projection spec can drive the same mapping the
 * endpoints use. A copy in the spec could be wrong in exactly the way the projection is wrong and
 * would prove nothing.
 *
 * The fields it reads are what `BUY_CRYPTO_HISTORY_RESPONSE_FIELDS` selects — the two are meant to
 * be changed together, and the mutation test fails if they drift apart.
 */
export class BuyCryptoHistoryMapper {
  static toDto(buyCrypto: BuyCrypto): HistoryDtoDeprecated {
    return {
      inputAmount: buyCrypto.inputAmount,
      inputAsset: buyCrypto.inputAsset,
      amlCheck: buyCrypto.amlCheck,
      outputAmount: buyCrypto.outputAmount,
      outputAsset: buyCrypto.outputAsset?.dexName,
      txId: buyCrypto.txId,
      txUrl:
        buyCrypto.outputAsset && buyCrypto.txId
          ? txExplorerUrl(buyCrypto.outputAsset.blockchain, buyCrypto.txId)
          : undefined,
      isComplete: buyCrypto.isComplete,
      date: buyCrypto.outputDate,
      status: PaymentStatusMapper[buyCrypto.status],
    };
  }
}
