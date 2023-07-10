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
  getCheckLiquidityStrategy(asset: Asset): CheckLiquidityStrategy | undefined {
    return (
      super.getStrategy({ blockchain: asset.blockchain, assetType: asset.type }) ??
      super.getStrategy({ blockchain: asset.blockchain, assetCategory: asset.category }) ??
      super.getStrategy({ blockchain: asset.blockchain })
    );
  }
}
