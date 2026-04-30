import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexBaseService } from '../../../services/dex-base.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class BaseTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(BaseTokenStrategy);

  constructor(dexBaseService: DexBaseService) {
    super(dexBaseService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
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
    return this.assetService.getBaseCoin();
  }
}
