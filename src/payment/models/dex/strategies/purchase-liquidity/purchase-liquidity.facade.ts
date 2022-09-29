import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { DeFiChainCryptoStrategy } from './impl/defichain-crypto.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';
import { PurchaseLiquidityStrategy } from './impl/base/purchase-liquidity.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from './impl/defichain-stock.strategy';

enum Alias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BscDefault',
}

export { Alias as PurchaseLiquidityStrategyAlias };

@Injectable()
export class PurchaseLiquidityStrategies {
  protected readonly purchaseLiquidityStrategies = new Map<Alias, PurchaseLiquidityStrategy>();

  constructor(
    @Inject(forwardRef(() => DeFiChainPoolPairStrategy))
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    ethereum: EthereumCryptoStrategy,
    bsc: BscCryptoStrategy,
  ) {
    this.purchaseLiquidityStrategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.purchaseLiquidityStrategies.set(Alias.DEFICHAIN_STOCK, deFiChainStock);
    this.purchaseLiquidityStrategies.set(Alias.DEFICHAIN_CRYPTO, deFiChainCrypto);
    this.purchaseLiquidityStrategies.set(Alias.ETHEREUM_DEFAULT, ethereum);
    this.purchaseLiquidityStrategies.set(Alias.BSC_DEFAULT, bsc);
  }

  getPurchaseLiquidityStrategy(criteria: Asset | Alias): PurchaseLiquidityStrategy {
    return criteria instanceof Asset
      ? this.getPurchaseLiquidityStrategyByAsset(criteria)
      : this.getPurchaseLiquidityStrategyByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getPurchaseLiquidityStrategyByAlias(alias: Alias): PurchaseLiquidityStrategy {
    const strategy = this.purchaseLiquidityStrategies.get(alias);

    if (!strategy) throw new Error(`No PurchaseLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getPurchaseLiquidityStrategyByAsset(asset: Asset): PurchaseLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getPurchaseLiquidityStrategyByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return Alias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return Alias.DEFICHAIN_STOCK;
      if (assetCategory === AssetCategory.CRYPTO) return Alias.DEFICHAIN_CRYPTO;
    }

    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC_DEFAULT;
  }
}
