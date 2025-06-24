import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class PolygonTokenStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, dexPolygonService: DexPolygonService) {
    super(dexPolygonService);

    this.logger = this.dfxLogger.create(PolygonTokenStrategy);
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
