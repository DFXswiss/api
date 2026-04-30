import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexPolygonService } from '../../../services/dex-polygon.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class PolygonTokenStrategy extends EvmTokenStrategy {
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
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getPolygonCoin();
  }
}
