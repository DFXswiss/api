import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellLiquidityStrategyAlias } from '../sell-liquidity.facade';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class ArbitrumCoinStrategy extends EvmCoinStrategy {
  protected readonly logger = new DfxLogger(ArbitrumCoinStrategy);

  constructor(protected readonly assetService: AssetService) {
    super(SellLiquidityStrategyAlias.ARBITRUM_COIN);
  }

  sellLiquidity(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Arbitrum coin');
  }

  addSellData(): Promise<void> {
    throw new Error('Selling liquidity on DEX is not supported for Arbitrum coin');
  }

  protected getFeeAsset(): Promise<Asset> {
    return this.assetService.getArbitrumCoin();
  }
}
