import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexSepoliaService } from '../../../services/dex-sepolia.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class SepoliaCoinStrategy extends EvmCoinStrategy {
  constructor(protected readonly assetService: AssetService, dexSepoliaService: DexSepoliaService) {
    super(dexSepoliaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.SEPOLIA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getSepoliaETH();
  }
}