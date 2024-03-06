import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { NoPurchaseStrategy } from './base/no-purchase.strategy';

@Injectable()
export class LightningStrategy extends NoPurchaseStrategy {
  protected readonly logger = new DfxLogger(LightningStrategy);

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getLightningCoin();
  }
}
