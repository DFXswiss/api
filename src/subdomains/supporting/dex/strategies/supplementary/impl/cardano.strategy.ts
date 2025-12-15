import { Injectable } from '@nestjs/common';
import { CardanoTransactionDto } from 'src/integration/blockchain/cardano/dto/cardano.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexCardanoService } from '../../../services/dex-cardano.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class CardanoStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexCardanoService: DexCardanoService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexCardanoService.sendNativeCoin(destinationAddress, amount)
      : this.dexCardanoService.sendToken(destinationAddress, asset, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexCardanoService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexCardanoService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((rh) => rh.amount === amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txId };
  }

  async getTargetAmount(_amount: number, _from: Asset, _to: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: CardanoTransactionDto[], since: Date): CardanoTransactionDto[] {
    return allHistory.filter((h) => Util.round(h.timestamp * 1000, 0) > since.getTime());
  }
}
