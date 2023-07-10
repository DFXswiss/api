import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class EthereumTokenStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(EthereumTokenStrategy);

  constructor(dexEthereumService: DexEthereumService) {
    super(dexEthereumService, []);
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
