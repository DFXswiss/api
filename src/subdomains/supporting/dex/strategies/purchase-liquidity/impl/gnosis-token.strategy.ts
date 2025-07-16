import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexGnosisService } from '../../../services/dex-gnosis.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class GnosisTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(GnosisTokenStrategy);

  constructor(dexGnosisService: DexGnosisService) {
    super(dexGnosisService);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
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
    return this.assetService.getGnosisCoin();
  }
}
