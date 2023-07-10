import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';
import { PurchaseStrategy } from './base/purchase.strategy';

@Injectable()
export class DeFiChainCryptoStrategy extends PurchaseStrategy {
  protected readonly logger = new DfxLogger(DeFiChainCryptoStrategy);

  constructor(dexService: DexDeFiChainService) {
    super(dexService, [{ name: 'DFI', type: AssetType.TOKEN }]);
  }

  get blockchain(): Blockchain {
    return Blockchain.DEFICHAIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get assetCategory(): AssetCategory {
    return AssetCategory.CRYPTO;
  }

  get dexName(): string {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getDfiCoin();
  }
}
