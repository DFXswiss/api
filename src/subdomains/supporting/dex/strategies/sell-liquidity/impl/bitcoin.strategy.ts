import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { SellLiquidityStrategy } from './base/sell-liquidity.strategy';

@Injectable()
export class BitcoinStrategy extends SellLiquidityStrategy {
  constructor(protected readonly assetService: AssetService) {
    super(SellLiquidityStrategyAlias.BITCOIN);
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for bitcoin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for bitcoin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getBtcCoin();
  }
}
