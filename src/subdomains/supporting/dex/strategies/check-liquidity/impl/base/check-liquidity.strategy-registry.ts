import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { CheckLiquidityStrategy } from './check-liquidity.strategy';

interface StrategyRegistryKey {
  blockchain: Blockchain;
  assetType?: AssetType;
  assetCategory?: AssetCategory;
}

export class CheckLiquidityStrategyRegistry extends StrategyRegistry<StrategyRegistryKey, CheckLiquidityStrategy> {
  getCheckLiquidityStrategy(asset: Asset): CheckLiquidityStrategy {
    const strategy =
      super.get({ blockchain: asset.blockchain, assetType: asset.type }) ??
      super.get({ blockchain: asset.blockchain, assetCategory: asset.category }) ??
      super.get({ blockchain: asset.blockchain });

    if (!strategy) {
      throw new Error(`No CheckLiquidityStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
