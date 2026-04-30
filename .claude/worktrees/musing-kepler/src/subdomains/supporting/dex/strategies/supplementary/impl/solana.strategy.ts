import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { SolanaTransactionDto } from 'src/integration/blockchain/solana/dto/solana.dto';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { DexSolanaService } from '../../../services/dex-solana.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class SolanaStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexSolanaService: DexSolanaService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexSolanaService.sendNativeCoin(destinationAddress, amount)
      : this.dexSolanaService.sendToken(destinationAddress, asset, amount);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexSolanaService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { amount, since } = query;

    const allHistory = await this.dexSolanaService.getRecentHistory(100);
    const relevantHistory = this.filterRelevantHistory(allHistory, since);
    const targetEntry = relevantHistory.find((rh) => rh.destinations.find((d) => d.amount === amount));

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.txid };
  }

  async getTargetAmount(_amount: number, _from: Asset, _to: Asset): Promise<number> {
    throw new Error(`Swapping is not implemented on ${this.blockchain}`);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(allHistory: SolanaTransactionDto[], since: Date): SolanaTransactionDto[] {
    return allHistory.filter((h) => Util.round(h.blocktime * 1000, 0) > since.getTime());
  }
}
