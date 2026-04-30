import { Injectable } from '@nestjs/common';
import { TransactionHistory } from 'src/integration/blockchain/bitcoin/node/bitcoin-based-client';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class BitcoinStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexBitcoinService: DexBitcoinService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, amount } = request;

    return this.dexBitcoinService.sendUtxoToMany([{ addressTo: destinationAddress, amount }]);
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

  async getTargetAmount(_a: number, _f: Asset, _t: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: TransactionHistory[], since: Date): TransactionHistory[] {
    return allHistory.filter((h) => Util.round(h.blocktime * 1000, 0) > since.getTime());
  }
}
