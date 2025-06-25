import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexGnosisService } from '../../../services/dex-gnosis.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class GnosisTokenStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, dexGnosisService: DexGnosisService) {
    super(dexGnosisService);

    this.logger = this.loggerFactory.create(GnosisTokenStrategy);
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
