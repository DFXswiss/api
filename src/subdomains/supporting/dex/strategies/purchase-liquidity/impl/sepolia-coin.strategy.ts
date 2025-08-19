import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class SepoliaCoinStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(SepoliaCoinStrategy);

  get blockchain(): Blockchain {
    return Blockchain.SEPOLIA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getSepoliaCoin();
  }
}
