import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class PolygonCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly assetService: AssetService,
    dexPolygonService: DexPolygonService,
  ) {
    super(dexPolygonService);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getPolygonCoin();
  }
}
