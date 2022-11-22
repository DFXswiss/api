import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(protected readonly assetService: AssetService, dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getEthCoin();
  }
}
