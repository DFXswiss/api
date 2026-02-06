import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexCitreaService } from '../../../services/dex-citrea.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class CitreaCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly assetService: AssetService,
    dexCitreaService: DexCitreaService,
  ) {
    super(dexCitreaService);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getCitreaCoin();
  }
}
