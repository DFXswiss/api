import { Injectable } from '@nestjs/common';
import { MoneroTransferDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexMoneroService } from '../../../services/dex-monero.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class MoneroStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexMoneroService: DexMoneroService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, amount } = request;

    return this.dexMoneroService.sendTransfer(destinationAddress, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexMoneroService.transferMinimal(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexMoneroService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexMoneroService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((e) => e.amount === amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txid };
  }

  async getTargetAmount(_a: number, _f: Asset, _t: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: MoneroTransferDto[], since: Date): MoneroTransferDto[] {
    return allHistory.filter((h) => Util.round(h.timestamp * 1000, 0) > since.getTime());
  }
}
