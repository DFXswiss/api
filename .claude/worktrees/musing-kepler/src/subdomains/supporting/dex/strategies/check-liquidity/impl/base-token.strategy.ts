import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexBaseService } from '../../../services/dex-base.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BaseTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly assetService: AssetService,
    dexBaseService: DexBaseService,
  ) {
    super(dexBaseService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  get assetCategory(): AssetCategory {
    return undefined;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBaseCoin();
  }
}
