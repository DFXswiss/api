import { Injectable } from '@nestjs/common';
import { TransactionHistory } from 'src/integration/blockchain/ain/node/btc-client';
import { Util } from 'src/shared/utils/util';
import { TransferRequest, TransactionQuery, TransactionResult } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';

@Injectable()
export class BitcoinStrategy {
  constructor(protected readonly dexBitcoinService: DexBitcoinService) {}

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, amount } = request;

    return this.dexBitcoinService.sendUtxoToMany([{ addressTo: destinationAddress, amount }]);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexBitcoinService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexBitcoinService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexBitcoinService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((e) => e.amount === amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txid };
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: TransactionHistory[], since: Date): TransactionHistory[] {
    return allHistory.filter((h) => Util.round(h.blocktime * 1000, 0) > since.getTime());
  }
}
