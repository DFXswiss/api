import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { TransactionQuery, TransactionResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexJellyfishService } from 'src/subdomains/supporting/dex/services/base/dex-jellyfish.service';
import { SupplementaryStrategy } from './supplementary.strategy';

export abstract class JellyfishStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexJellyfishService: DexJellyfishService) {
    super();
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;

    const allHistory = await this.dexJellyfishService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const relevantEntries = this.parseHistory(relevantHistory);
    const targetEntry = relevantEntries.find((e) => e.amount === amount && e.asset === asset.dexName);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txid };
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: AccountHistory[], since: Date): AccountHistory[] {
    // TODO -> double check if blocktime is a timestamp
    return allHistory.filter((h) => h.blockTime > since.getTime());
  }

  private parseHistory(history: AccountHistory[]): { asset: string; amount: number; txid: string }[] {
    return history.reduce(
      (acc: { asset: string; amount: number; txid: string }[], h) => [
        ...acc,
        ...this.dexJellyfishService.parseAmounts(h.amounts).map((a) => ({ ...a, txid: h.txid })),
      ],
      [],
    );
  }
}
