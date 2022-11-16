import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { SellLiquidityStrategy } from './impl/base/sell-liquidity.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscCoinStrategy } from './impl/bsc-coin.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { DeFiChainCoinStrategy } from './impl/defichain-coin.strategy';
import { DeFiChainTokenStrategy } from './impl/defichain-token.strategy';
import { EthereumCoinStrategy } from './impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  BSC_COIN = 'BscCoin',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_COIN = 'DeFiChainCoin',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_COIN = 'EthereumCoin',
  ETHEREUM_TOKEN = 'EthereumToken',
}

export { Alias as SellLiquidityStrategyAlias };

@Injectable()
export class SellLiquidityStrategies {
  protected readonly strategies = new Map<Alias, SellLiquidityStrategy>();

  constructor(
    bitcoin: BitcoinStrategy,
    bscCoin: BscCoinStrategy,
    bscToken: BscTokenStrategy,
    deFiChainCoin: DeFiChainCoinStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCoin: EthereumCoinStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_COIN, bscCoin);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_COIN, deFiChainCoin);
    this.strategies.set(Alias.DEFICHAIN_TOKEN, deFiChainToken);
    this.strategies.set(Alias.ETHEREUM_COIN, ethereumCoin);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
  }

  getSellLiquidityStrategy(criteria: Asset | Alias): SellLiquidityStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): SellLiquidityStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No SellLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): SellLiquidityStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
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
  }
}
