import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexZanoService } from '../../../services/dex-zano.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class ZanoStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexZanoService: DexZanoService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexZanoService.sendCoin(destinationAddress, amount)
      : this.dexZanoService.sendToken(destinationAddress, asset, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexZanoService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexZanoService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((e) => Util.sum(e.receive.map((r) => r.amount)) === amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txId };
  }

  async getTargetAmount(_a: number, _f: Asset, _t: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: ZanoTransferDto[], since: Date): ZanoTransferDto[] {
    return allHistory.filter((h) => Util.round(h.timestamp * 1000, 0) > since.getTime());
  }
}
