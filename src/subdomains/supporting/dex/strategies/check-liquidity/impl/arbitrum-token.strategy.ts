import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class ArbitrumTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexArbitrumService: DexArbitrumService) {
    super(dexArbitrumService);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
