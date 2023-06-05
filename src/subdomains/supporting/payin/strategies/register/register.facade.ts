import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { ArbitrumStrategy } from './impl/arbitrum.strategy';
import { RegisterStrategy } from './impl/base/register.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscStrategy } from './impl/bsc.strategy';
import { DeFiChainStrategy } from './impl/defichain.strategy';
import { EthereumStrategy } from './impl/ethereum.strategy';
import { OptimismStrategy } from './impl/optimism.strategy';
import { LightningStrategy } from './impl/lightning.strategy';

enum Alias {
  ARBITRUM = 'Arbitrum',
  BITCOIN = 'Bitcoin',
  BSC = 'Bsc',
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
  OPTIMISM = 'Optimism',
  LIGHTNING = 'Lightning',
}

export { Alias as RegisterStrategyAlias };

@Injectable()
export class RegisterStrategiesFacade {
  protected readonly strategies: Map<Alias, RegisterStrategy> = new Map();

  constructor(
    arbitrum: ArbitrumStrategy,
    bitcoin: BitcoinStrategy,
    bsc: BscStrategy,
    deFiChain: DeFiChainStrategy,
    ethereum: EthereumStrategy,
    optimism: OptimismStrategy,
    lightning: LightningStrategy,
  ) {
    this.strategies.set(Alias.ARBITRUM, arbitrum);
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC, bsc);
    this.strategies.set(Alias.DEFICHAIN, deFiChain);
    this.strategies.set(Alias.ETHEREUM, ethereum);
    this.strategies.set(Alias.OPTIMISM, optimism);
    this.strategies.set(Alias.LIGHTNING, lightning);
  }

  getRegisterStrategy(criteria: Asset | Alias): RegisterStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  getRegisterStrategyAlias(asset: Asset): Alias {
    const { blockchain } = asset;

    if (blockchain === Blockchain.ARBITRUM) return Alias.ARBITRUM;
    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC;
    if (blockchain === Blockchain.DEFICHAIN) return Alias.DEFICHAIN;
    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM;
    if (blockchain === Blockchain.OPTIMISM) return Alias.OPTIMISM;
    if (blockchain === Blockchain.LIGHTNING) return Alias.LIGHTNING;
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): RegisterStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No RegisterStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): RegisterStrategy {
    const alias = this.getRegisterStrategyAlias(asset);

    return this.getByAlias(alias);
  }
}
