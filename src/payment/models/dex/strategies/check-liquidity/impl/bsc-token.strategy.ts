import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService, dexBscService: DexBscService) {
    super(dexBscService);
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: 'BNB',
      blockchain: Blockchain.BINANCE_SMART_CHAIN,
      type: AssetType.COIN,
    });
  }
}
