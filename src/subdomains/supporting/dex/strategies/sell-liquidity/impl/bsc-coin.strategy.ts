import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  constructor(protected readonly assetService: AssetService) {
    super(SellLiquidityStrategyAlias.BSC_COIN);
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for BSC coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for BSC coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBnbCoin();
  }
}
