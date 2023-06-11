import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { SellLiquidityStrategy } from './sell-liquidity.strategy';

interface StrategyRegistryKey {
  blockchain: Blockchain;
  assetType?: AssetType;
}

export class SellLiquidityStrategyRegistry extends StrategyRegistry<StrategyRegistryKey, SellLiquidityStrategy> {
  getSellLiquidityStrategy(asset: Asset): SellLiquidityStrategy {
    let strategy = super.getStrategy({ blockchain: asset.blockchain, assetType: asset.type });

    if (!strategy) {
      // Check for 'BitcoinStrategy'
      strategy = super.getStrategy({ blockchain: asset.blockchain });
    }

    if (!strategy) {
      throw new Error(`No SellLiquidityStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
