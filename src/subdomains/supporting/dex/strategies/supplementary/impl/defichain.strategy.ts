import { Injectable } from '@nestjs/common';
import { TransferRequest } from '../../../interfaces';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class DeFiChainStrategy extends JellyfishStrategy {
  constructor(protected readonly dexJellyfishService: DexDeFiChainService) {
    super(dexJellyfishService);
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return this.dexJellyfishService.transferLiquidity(destinationAddress, asset.dexName, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexJellyfishService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexJellyfishService.checkTransferCompletion(transferTxId);
  }
}
