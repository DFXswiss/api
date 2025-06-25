import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class EthereumTokenStrategy extends PurchaseStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, dexEthereumService: DexEthereumService) {
    super(dexEthereumService);

    this.logger = this.loggerFactory.create(EthereumTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
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
    return this.assetService.getEthCoin();
  }
}
