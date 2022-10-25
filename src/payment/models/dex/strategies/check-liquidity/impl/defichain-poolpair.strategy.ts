import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CheckLiquidityResult, LiquidityRequest } from '../../../interfaces';
import { CheckLiquidityUtil } from '../utils/check-liquidity.util';
import { CheckLiquidityStrategy } from './base/check-liquidity.strategy';

@Injectable()
export class DeFiChainPoolPairStrategy extends CheckLiquidityStrategy {
  constructor(protected readonly assetService: AssetService) {
    super();
  }

  // assume there is no poolpair liquidity available on DEX node
  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    return CheckLiquidityUtil.createNonPurchasableCheckLiquidityResult(request, 0, 0, await this.feeAsset());
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: 'DFI',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.COIN,
    });
  }
}
