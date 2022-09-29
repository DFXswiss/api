import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityStrategy } from './impl/base/check-liquidity.strategy';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { DeFiChainDefaultStrategy } from './impl/defichain-default.strategy';
import { DeFiChainPoolPairStrategy } from './impl/defichain-poolpair.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';

enum Alias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BscDefault',
}

export { Alias as CheckLiquidityAlias };

@Injectable()
export class CheckLiquidityStrategies {
  protected readonly strategies = new Map<Alias, CheckLiquidityStrategy>();

  constructor(
    deFiChainPoolPair: DeFiChainPoolPairStrategy,
    deFiChainDefault: DeFiChainDefaultStrategy,
    ethereum: EthereumCryptoStrategy,
    bsc: BscCryptoStrategy,
  ) {
    this.strategies.set(Alias.DEFICHAIN_POOL_PAIR, deFiChainPoolPair);
    this.strategies.set(Alias.DEFICHAIN_DEFAULT, deFiChainDefault);
    this.strategies.set(Alias.ETHEREUM_DEFAULT, ethereum);
    this.strategies.set(Alias.BSC_DEFAULT, bsc);
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

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return Alias.DEFICHAIN_POOL_PAIR;
      return Alias.DEFICHAIN_DEFAULT;
    }

    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC_DEFAULT;
  }
}
