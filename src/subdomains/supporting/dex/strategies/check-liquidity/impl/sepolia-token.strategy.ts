import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexSepoliaService } from '../../../services/dex-sepolia.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class SepoliaTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexSepoliaService: DexSepoliaService) {
    super(dexSepoliaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.SEPOLIA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getSepoliaCoin();
  }
}
