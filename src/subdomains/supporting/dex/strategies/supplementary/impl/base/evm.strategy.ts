import { BadRequestException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { TransactionQuery, TransactionResult, TransferRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexEvmService } from 'src/subdomains/supporting/dex/services/base/dex-evm.service';
import { SupplementaryStrategy } from './supplementary.strategy';

export abstract class EvmStrategy extends SupplementaryStrategy {
  constructor(protected readonly dexEvmService: DexEvmService) {
    super();
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return asset.type === AssetType.COIN
      ? this.dexEvmService.sendNativeCoin(destinationAddress, amount)
      : this.dexEvmService.sendToken(destinationAddress, asset, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexEvmService.sendNativeCoin(address, Config.blockchain.evm.minimalPreparationFee);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexEvmService.checkTransactionCompletion(transferTxId);
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;
    const [coinHistory, tokenHistory] = await this.dexEvmService.getDexHistory();
    const [relevantCoinHistory, relevantTokenHistory] = this.filterRelevantHistory(coinHistory, tokenHistory, since);

    const targetEntry =
      asset.type === AssetType.COIN
        ? this.findTargetCoinEntry(relevantCoinHistory, amount)
        : await this.findTargetTokenEntry(relevantTokenHistory, asset, amount);

    if (!targetEntry) return { isComplete: false };

    return { isComplete: true, txId: targetEntry.hash };
  }

  async getTargetAmount(amount: number, from: Asset, to: Asset): Promise<number> {
    return this.dexEvmService.getTargetAmount(from, amount, to);
  }

  //*** HELPER METHODS ***//

  private filterRelevantHistory(
    coinHistory: EvmCoinHistoryEntry[],
    tokenHistory: EvmTokenHistoryEntry[],
    since: Date,
  ): [EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]] {
    return [
      coinHistory.filter((h) => Util.round(parseInt(h.timeStamp) * 1000, 0) > since.getTime()),
      tokenHistory.filter((h) => Util.round(parseInt(h.timeStamp) * 1000, 0) > since.getTime()),
    ];
  }

  private findTargetCoinEntry(history: EvmCoinHistoryEntry[], amount: number): EvmCoinHistoryEntry | undefined {
    return history.find((h) => this.dexEvmService.fromWeiAmount(h.value) === amount);
  }

  private async findTargetTokenEntry(
    history: EvmTokenHistoryEntry[],
    asset: Asset,
    amount: number,
  ): Promise<EvmTokenHistoryEntry | undefined> {
    const contract = this.dexEvmService.getERC20ContractForDex(asset.chainId);

    if (!contract) {
      throw new BadRequestException(
        `No ERC-20 contract found for token ID ${asset.chainId} when trying to execute #findTransaction() API `,
      );
    }

    const decimals = await contract.decimals();

    return history.find((h) => this.dexEvmService.fromWeiAmount(h.value, decimals) === amount);
  }
}
