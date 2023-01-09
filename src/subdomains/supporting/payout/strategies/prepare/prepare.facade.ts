import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { ArbitrumStrategy } from './impl/arbitrum.strategy';
import { PrepareStrategy } from './impl/base/prepare.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscStrategy } from './impl/bsc.strategy';
import { DeFiChainStrategy } from './impl/defichain.strategy';
import { EthereumStrategy } from './impl/ethereum.strategy';
import { OptimismStrategy } from './impl/optimism.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
  BSC = 'Bsc',
  ARBITRUM = 'Arbitrum',
  OPTIMISM = 'Optimism',
}

export { Alias as PrepareStrategyAlias };

@Injectable()
export class PrepareStrategiesFacade {
  protected readonly strategies: Map<Alias, PrepareStrategy> = new Map();

  constructor(
    bitcoin: BitcoinStrategy,
    deFiChainStrategy: DeFiChainStrategy,
    ethereumStrategy: EthereumStrategy,
    bscStrategy: BscStrategy,
    arbitrumStrategy: ArbitrumStrategy,
    optimismStrategy: OptimismStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.DEFICHAIN, deFiChainStrategy);
    this.strategies.set(Alias.ETHEREUM, ethereumStrategy);
    this.strategies.set(Alias.BSC, bscStrategy);
    this.strategies.set(Alias.ARBITRUM, arbitrumStrategy);
    this.strategies.set(Alias.OPTIMISM, optimismStrategy);
  }

  getPrepareStrategy(criteria: Asset | Alias): PrepareStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): PrepareStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PrepareStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): PrepareStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { blockchain } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;
    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC;
    if (blockchain === Blockchain.ARBITRUM) return Alias.ARBITRUM;
    if (blockchain === Blockchain.OPTIMISM) return Alias.OPTIMISM;
    if (blockchain === Blockchain.DEFICHAIN) return Alias.DEFICHAIN;
  }
}
