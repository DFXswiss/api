import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { PurchaseDexService, PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class PolygonCoinStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, protected readonly dexService: PurchaseDexService) {
    super(dexService);

    this.logger = this.dfxLogger.create(PolygonCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
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
    return this.assetService.getPolygonCoin();
  }
}
