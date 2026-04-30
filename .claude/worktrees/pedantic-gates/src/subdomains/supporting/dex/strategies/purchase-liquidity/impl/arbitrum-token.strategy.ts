import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexArbitrumService } from '../../../services/dex-arbitrum.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class ArbitrumTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(ArbitrumTokenStrategy);

  constructor(dexArbitrumService: DexArbitrumService) {
    super(dexArbitrumService);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
