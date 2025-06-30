import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { NoPurchaseStrategy } from './base/no-purchase.strategy';

@Injectable()
export class BitcoinStrategy extends NoPurchaseStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory) {
    super();

    this.logger = this.loggerFactory.create(BitcoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBtcCoin();
  }
}
