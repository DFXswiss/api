import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { ArbitrumStrategy } from './impl/arbitrum.strategy';
import { SupplementaryStrategy } from './impl/base/supplementary.strategy';
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

export { Alias as SupplementaryStrategyAlias };

@Injectable()
export class SupplementaryStrategies {
  protected readonly strategies: Map<Alias, SupplementaryStrategy> = new Map();

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

  getSupplementaryStrategy(criteria: Asset | Blockchain | Alias): SupplementaryStrategy {
    if (criteria instanceof Asset) {
      return this.getByAsset(criteria);
    }

    if (Object.values(Blockchain).includes(criteria as Blockchain)) {
      return this.getByBlockchain(criteria as Blockchain);
    }

    return this.getByAlias(criteria as Alias);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): SupplementaryStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No SupplementaryStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): SupplementaryStrategy {
    const alias = this.getAlias(asset.blockchain);

    return this.getByAlias(alias);
  }

  private getByBlockchain(blockchain: Blockchain): SupplementaryStrategy {
    const alias = this.getAlias(blockchain);

    return this.getByAlias(alias);
  }

  private getAlias(blockchain: Blockchain): Alias {
    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;
    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC;
    if (blockchain === Blockchain.ARBITRUM) return Alias.ARBITRUM;
    if (blockchain === Blockchain.OPTIMISM) return Alias.OPTIMISM;
    if (blockchain === Blockchain.DEFICHAIN) return Alias.DEFICHAIN;
  }
}
