import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityStrategy } from './impl/base/check-liquidity.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscCoinStrategy } from './impl/bsc-coin.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { DeFiChainDefaultStrategy } from './impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { EthereumCoinStrategy } from './impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  BSC_COIN = 'BscCoin',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_COIN = 'EthereumCoin',
  ETHEREUM_TOKEN = 'EthereumToken',
}

export { Alias as CheckLiquidityAlias };

@Injectable()
export class CheckLiquidityStrategies {
  protected readonly strategies = new Map<Alias, CheckLiquidityStrategy>();

  constructor(
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDefault: DeFiChainDefaultStrategy,
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_COIN, bscCoin);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.strategies.set(Alias.DEFICHAIN_DEFAULT, deFiChainDefault);
    this.strategies.set(Alias.ETHEREUM_COIN, ethereumCoin);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
  }

  getCheckLiquidityStrategy(criteria: Asset | Alias): CheckLiquidityStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): CheckLiquidityStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No CheckLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): CheckLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { blockchain, category: assetCategory, type: assetType } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;

    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) {
      return assetType === AssetType.COIN ? Alias.BSC_COIN : Alias.BSC_TOKEN;
    }

    if (blockchain === Blockchain.DEFICHAIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return Alias.DEFICHAIN_POOL_PAIR;
      return Alias.DEFICHAIN_DEFAULT;
    }

    if (blockchain === Blockchain.ETHEREUM) {
      return assetType === AssetType.COIN ? Alias.ETHEREUM_COIN : Alias.ETHEREUM_TOKEN;
    }
  }
}
