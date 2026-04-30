import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexBscService } from '../../../services/dex-bsc.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class BscTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(BscTokenStrategy);

  constructor(dexBscService: DexBscService) {
    super(dexBscService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
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
    return this.assetService.getBnbCoin();
  }
}
