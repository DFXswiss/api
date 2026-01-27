import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexCitreaService } from '../../../services/dex-citrea.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class CitreaTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(CitreaTokenStrategy);

  constructor(dexCitreaService: DexCitreaService) {
    super(dexCitreaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
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
    return this.assetService.getCitreaCoin();
  }
}
