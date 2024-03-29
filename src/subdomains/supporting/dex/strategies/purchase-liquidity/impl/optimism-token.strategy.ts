import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class OptimismTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(OptimismTokenStrategy);

  constructor(dexOptimismService: DexOptimismService) {
    super(dexOptimismService);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
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
    return this.assetService.getOptimismCoin();
  }
}
