import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(protected readonly assetService: AssetService) {
    super(SellLiquidityStrategyAlias.BSC_TOKEN);
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for BSC token');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for BSC token');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBnbCoin();
  }
}
