import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityStrategy } from './impl/base/check-liquidity.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { DeFiChainDefaultStrategy } from './impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  BSC_CRYPTO = 'BscCrypto',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_CRYPTO = 'EthereumCrypto',
  ETHEREUM_TOKEN = 'EthereumToken',
}

export { Alias as CheckLiquidityAlias };

@Injectable()
export class CheckLiquidityStrategies {
  protected readonly strategies = new Map<Alias, CheckLiquidityStrategy>();

  constructor(
    bitcoin: BitcoinStrategy,
    bscCrypto: BscCryptoStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDefault: DeFiChainDefaultStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_CRYPTO, bscCrypto);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.strategies.set(Alias.DEFICHAIN_DEFAULT, deFiChainDefault);
    this.strategies.set(Alias.ETHEREUM_CRYPTO, ethereumCrypto);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
  }

  getCheckLiquidityStrategy(criteria: Asset | Alias): CheckLiquidityStrategy {
    return criteria instanceof Asset
      ? this.getCheckLiquidityStrategyByAsset(criteria)
      : this.getCheckLiquidityStrategyByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getCheckLiquidityStrategyByAlias(alias: Alias): CheckLiquidityStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No CheckLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getCheckLiquidityStrategyByAsset(asset: Asset): CheckLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getCheckLiquidityStrategyByAlias(alias);
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
      return Alias.DEFICHAIN_DEFAULT;
    }

    if (blockchain === Blockchain.ETHEREUM) {
      if (assetCategory === AssetCategory.CRYPTO) return Alias.ETHEREUM_CRYPTO;
      if (assetCategory === AssetCategory.STOCK) return Alias.ETHEREUM_TOKEN;
    }
  }
}
