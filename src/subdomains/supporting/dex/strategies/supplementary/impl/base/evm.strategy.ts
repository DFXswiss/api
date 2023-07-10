import { Config } from 'src/config/config';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexEvmService } from 'src/subdomains/supporting/dex/services/base/dex-evm.service';
import { SupplementaryStrategy } from './supplementary.strategy';

export abstract class EvmStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexEvmService.sendNativeCoin(destinationAddress, amount)
      : this.dexEvmService.sendToken(destinationAddress, asset, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexEvmService.sendNativeCoin(address, Config.blockchain.evm.minimalPreparationFee);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexEvmService.checkTransactionCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;
    const [coinHistory, tokenHistory] = await this.dexEvmService.getDexHistory();
    const relevantHistory = this.filterRelevantHistory(coinHistory, tokenHistory, asset, since);

    const targetEntry = await this.findHistoryEntry(relevantHistory, asset, amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.hash };
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(
    coinHistory: EvmCoinHistoryEntry[],
    tokenHistory: EvmTokenHistoryEntry[],
    asset: Asset,
    since: Date,
  ): (EvmCoinHistoryEntry | EvmTokenHistoryEntry)[] {
    return asset.type === AssetType.COIN
      ? coinHistory.filter((h) => Util.round(parseInt(h.timeStamp) * 1000, 0) > since.getTime())
      : tokenHistory.filter((h) => Util.round(parseInt(h.timeStamp) * 1000, 0) > since.getTime());
  }

  private async findHistoryEntry<T extends EvmCoinHistoryEntry | EvmTokenHistoryEntry>(
    history: T[],
    asset: Asset,
    amount: number,
  ): Promise<T> {
    for (const h of history) {
      const historyAmount = await this.dexEvmService.fromWeiAmount(h.value, asset);
      if (historyAmount === amount) return h;
    }
  }
}
