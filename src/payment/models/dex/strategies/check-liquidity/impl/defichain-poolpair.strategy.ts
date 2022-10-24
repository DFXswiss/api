import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityResult } from '../../../interfaces';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainPoolPairStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly assetService: AssetService) {
    super();
  }
  // assume there is no poolpair liquidity available on DEX node
  async checkLiquidity(): Promise<CheckLiquidityResult> {
    return 0;
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({ dexName: 'DFI', blockchain: Blockchain.DEFICHAIN });
  }
}
