import { Config } from 'src/config/config';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { TransactionQuery, TransactionResult, TransferRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexEvmService } from 'src/subdomains/supporting/dex/services/dex-evm.service';
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

  async findTransaction(_query: TransactionQuery): Promise<TransactionResult> {
    throw new Error('Method not implemented');
  }
}
