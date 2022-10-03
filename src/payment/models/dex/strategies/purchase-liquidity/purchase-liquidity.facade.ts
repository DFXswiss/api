import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { DeFiChainCryptoStrategy } from './impl/defichain-crypto.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';
import { PurchaseLiquidityStrategy } from './impl/base/purchase-liquidity.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { DeFiChainStockStrategy } from './impl/defichain-stock.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  BSC_CRYPTO = 'BscCrypto',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  ETHEREUM_CRYPTO = 'EthereumCrypto',
  ETHEREUM_TOKEN = 'EthereumToken',
}

export { Alias as PurchaseLiquidityStrategyAlias };

@Injectable()
export class PurchaseLiquidityStrategies {
  protected readonly strategies = new Map<Alias, PurchaseLiquidityStrategy>();

  constructor(
    bitcoin: BitcoinStrategy,
    bscCrypto: BscCryptoStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCrypto: DeFiChainCryptoStrategy,
    @Inject(forwardRef(() => DeFiChainPoolPairStrategy))
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainStock: DeFiChainStockStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_CRYPTO, bscCrypto);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.strategies.set(Alias.DEFICHAIN_STOCK, deFiChainStock);
    this.strategies.set(Alias.DEFICHAIN_CRYPTO, deFiChainCrypto);
    this.strategies.set(Alias.ETHEREUM_CRYPTO, ethereumCrypto);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
  }

  getPurchaseLiquidityStrategy(criteria: Asset | Alias): PurchaseLiquidityStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): PurchaseLiquidityStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PurchaseLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): PurchaseLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;

    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) {
      if (assetCategory === AssetCategory.CRYPTO) return Alias.BSC_CRYPTO;
      if (assetCategory === AssetCategory.STOCK) return Alias.BSC_TOKEN;
    }

    if (blockchain === Blockchain.DEFICHAIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return Alias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return Alias.DEFICHAIN_STOCK;
      if (assetCategory === AssetCategory.CRYPTO) return Alias.DEFICHAIN_CRYPTO;
    }

    if (blockchain === Blockchain.ETHEREUM) {
      if (assetCategory === AssetCategory.CRYPTO) return Alias.ETHEREUM_CRYPTO;
      if (assetCategory === AssetCategory.STOCK) return Alias.ETHEREUM_TOKEN;
    }
  }
}
