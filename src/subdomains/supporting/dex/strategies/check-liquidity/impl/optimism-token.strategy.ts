import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexOptimismService } from '../../../services/dex-optimism.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    dexOptimismService: DexOptimismService,
  ) {
    super(dexOptimismService);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getOptimismCoin();
  }
}
