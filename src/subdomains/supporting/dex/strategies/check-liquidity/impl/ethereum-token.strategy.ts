import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexEthereumService: DexEthereumService) {
    super(dexEthereumService);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getEthCoin();
  }
}
