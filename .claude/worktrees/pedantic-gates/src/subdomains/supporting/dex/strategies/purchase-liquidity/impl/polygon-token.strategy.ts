import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class PolygonTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(PolygonTokenStrategy);

  constructor(dexPolygonService: DexPolygonService) {
    super(dexPolygonService);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
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
    return this.assetService.getPolygonCoin();
  }
}
