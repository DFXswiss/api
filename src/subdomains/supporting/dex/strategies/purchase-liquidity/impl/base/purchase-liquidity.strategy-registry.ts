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
    let strategy = super.getStrategy({ blockchain: asset.blockchain, assetType: asset.type });

    if (!strategy) {
      // Check for 'DeFiChainDfiStrategy'
      strategy = super.getStrategy({
        blockchain: asset.blockchain,
        assetCategory: asset.category,
        dexName: asset.dexName,
      });
    }

    if (!strategy) {
      // Check for 'DeFiChainCryptoStrategy'
      // Check for 'DeFiChainPoolPairStrategy'
      // Check for 'DeFiChainStockStrategy'
      strategy = super.getStrategy({ blockchain: asset.blockchain, assetCategory: asset.category });
    }

    if (!strategy) {
      // Check for 'BitcoinStrategy'
      strategy = super.getStrategy({ blockchain: asset.blockchain });
    }

    if (!strategy) {
      throw new Error(`No PurchaseLiquidityStrategy found. Blockchain: ${asset.blockchain}, AssetType: ${asset.type}`);
    }

    return strategy;
  }
}
