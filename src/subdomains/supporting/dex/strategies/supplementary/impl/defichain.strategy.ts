import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';

@Injectable()
export class DeFiChainStrategy {
  constructor(protected readonly dexDeFiChainService: DexDeFiChainService) {}

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return this.dexDeFiChainService.transferLiquidity(destinationAddress, asset.dexName, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexDeFiChainService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexDeFiChainService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;

    const allHistory = await this.dexDeFiChainService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const relevantEntries = this.parseHistory(relevantHistory);
    const targetEntry = relevantEntries.find((e) => e.amount === amount && e.asset === asset.dexName);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txid };
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: AccountHistory[], since: Date): AccountHistory[] {
    return allHistory.filter((h) => Util.round(h.blockTime * 1000, 0) > since.getTime());
  }

  private parseHistory(history: AccountHistory[]): { asset: string; amount: number; txid: string }[] {
    return history.reduce(
      (acc: { asset: string; amount: number; txid: string }[], h) => [
        ...acc,
        ...this.dexDeFiChainService.parseAmounts(h.amounts).map((a) => ({ ...a, txid: h.txid })),
      ],
      [],
    );
  }
}
