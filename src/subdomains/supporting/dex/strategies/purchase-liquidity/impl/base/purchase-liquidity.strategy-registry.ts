import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { StrategyRegistry } from 'src/subdomains/supporting/common/strategy-registry';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

interface StrategyRegistryKey {
  blockchain: Blockchain;
  assetType?: AssetType;
  assetCategory?: AssetCategory;
  dexName?: string;
}

export class PurchaseLiquidityStrategyRegistry extends StrategyRegistry<
  StrategyRegistryKey,
  PurchaseLiquidityStrategy
> {
  getPurchaseLiquidityStrategy(asset: Asset): PurchaseLiquidityStrategy {
    const strategy =
      super.getStrategy({ blockchain: asset.blockchain, assetType: asset.type }) ??
      super.getStrategy({
        blockchain: asset.blockchain,
        assetCategory: asset.category,
        dexName: asset.dexName,
      }) ??
      super.getStrategy({ blockchain: asset.blockchain, assetCategory: asset.category }) ??
      super.getStrategy({ blockchain: asset.blockchain });

    if (!strategy) {
      throw new Error(`No PurchaseLiquidityStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
