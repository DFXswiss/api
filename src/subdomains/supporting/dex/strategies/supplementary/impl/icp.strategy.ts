import { Injectable } from '@nestjs/common';
import { IcpTransfer } from 'src/integration/blockchain/icp/dto/icp.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexIcpService } from '../../../services/dex-icp.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class IcpStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexIcpService: DexIcpService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexIcpService.sendNativeCoin(destinationAddress, amount)
      : this.dexIcpService.sendToken(destinationAddress, asset, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexIcpService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;

    const allHistory =
      asset.type === AssetType.COIN
        ? await this.dexIcpService.getRecentHistory(100)
        : await this.dexIcpService.getRecentTokenHistory(asset, 100);

    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((e) => e.amount === amount);

    if (!targetEntry) return { isComplete: false };

    const txId =
      asset.type === AssetType.COIN ? String(targetEntry.blockIndex) : `${asset.chainId}:${targetEntry.blockIndex}`;

    return { isComplete: true, txId };
  }

  async getTargetAmount(_a: number, _f: Asset, _t: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: IcpTransfer[], since: Date): IcpTransfer[] {
    return allHistory.filter((h) => Util.round(h.timestamp * 1000, 0) > since.getTime());
  }
}
