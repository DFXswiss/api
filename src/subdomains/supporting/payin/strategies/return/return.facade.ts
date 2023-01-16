import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { ArbitrumCoinStrategy } from './impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from './impl/arbitrum-token.strategy';
import { ReturnStrategy } from './impl/base/return.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscCoinStrategy } from './impl/bsc-coin.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { DeFiChainCoinStrategy } from './impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy } from './impl/defichain-token.strategy';
import { EthereumCoinStrategy } from './impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';
import { OptimismCoinStrategy } from './impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from './impl/optimism-token.strategy';

enum Alias {
  ARBITRUM_COIN = 'ArbitrumCoin',
  ARBITRUM_TOKEN = 'ArbitrumToken',
  BITCOIN = 'Bitcoin',
  BSC_COIN = 'BscCoin',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_COIN = 'DeFiChainCoin',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_COIN = 'EthereumCoin',
  ETHEREUM_TOKEN = 'EthereumToken',
  OPTIMISM_COIN = 'OptimismCoin',
  OPTIMISM_TOKEN = 'OptimismToken',
}

export { Alias as ReturnStrategyAlias };

@Injectable()
export class ReturnFacade {
  protected readonly strategies: Map<Alias, ReturnStrategy> = new Map();

  constructor(
    arbitrumCoin: ArbitrumCoinStrategy,
    arbitrumToken: ArbitrumTokenStrategy,
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCoin: DeFiChainCoinStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
    optimismCoin: OptimismCoinStrategy,
    optimismToken: OptimismTokenStrategy,
  ) {
    this.strategies.set(Alias.ARBITRUM_COIN, arbitrumCoin);
    this.strategies.set(Alias.ARBITRUM_TOKEN, arbitrumToken);
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_COIN, bscCoin);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_COIN, deFiChainCoin);
    this.strategies.set(Alias.DEFICHAIN_TOKEN, deFiChainToken);
    this.strategies.set(Alias.ETHEREUM_COIN, ethereumCoin);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
    this.strategies.set(Alias.OPTIMISM_COIN, optimismCoin);
    this.strategies.set(Alias.OPTIMISM_TOKEN, optimismToken);
  }

  getPayoutStrategy(criteria: Asset | Alias): ReturnStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  getPayoutStrategyAlias(asset: Asset): Alias {
    const { blockchain, type: assetType } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;

    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) {
      return assetType === AssetType.COIN ? Alias.BSC_COIN : Alias.BSC_TOKEN;
    }

    if (blockchain === Blockchain.DEFICHAIN) {
      return assetType === AssetType.COIN ? Alias.DEFICHAIN_COIN : Alias.DEFICHAIN_TOKEN;
    }

    if (blockchain === Blockchain.ETHEREUM) {
      return assetType === AssetType.COIN ? Alias.ETHEREUM_COIN : Alias.ETHEREUM_TOKEN;
    }

    if (blockchain === Blockchain.ARBITRUM) {
      return assetType === AssetType.COIN ? Alias.ARBITRUM_COIN : Alias.ARBITRUM_TOKEN;
    }

    if (blockchain === Blockchain.OPTIMISM) {
      return assetType === AssetType.COIN ? Alias.OPTIMISM_COIN : Alias.OPTIMISM_TOKEN;
    }
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): ReturnStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PayoutStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): ReturnStrategy {
    const alias = this.getPayoutStrategyAlias(asset);

    return this.getByAlias(alias);
  }
}
