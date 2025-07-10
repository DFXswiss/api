import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TronTransactionDto } from 'src/integration/blockchain/tron/dto/tron.dto';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexTronService } from '../../../services/dex-tron.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class TronStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexTronService: DexTronService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexTronService.sendNativeCoin(destinationAddress, amount)
      : this.dexTronService.sendToken(destinationAddress, asset, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexTronService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexTronService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((rh) => rh.amount === amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txId };
  }

  async getTargetAmount(_amount: number, _from: Asset, _to: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: TronTransactionDto[], since: Date): TronTransactionDto[] {
    return allHistory.filter((h) => Util.round(h.timestamp * 1000, 0) > since.getTime());
  }
}
