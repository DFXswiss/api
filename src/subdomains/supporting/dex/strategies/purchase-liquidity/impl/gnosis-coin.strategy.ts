import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { PurchaseDexService, PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class GnosisCoinStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, dexService: PurchaseDexService) {
    super(dexService);

    this.logger = this.loggerFactory.create(GnosisCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
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
    return this.assetService.getGnosisCoin();
  }
}
