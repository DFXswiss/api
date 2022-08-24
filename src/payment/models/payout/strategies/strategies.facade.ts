import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutDFIStrategy } from './payout/payout-dfi.strategy';
import { PayoutETHStrategy } from './payout/payout-eth.strategy';
import { PayoutTokenStrategy } from './payout/payout-token.strategy';
import { PayoutStrategy } from './payout/payout.strategy';
import { PrepareOnDefichainStrategy } from './prepare/prepare-on-defichain.strategy';
import { PrepareOnEthereumStrategy } from './prepare/prepare-on-ethereum.strategy';
import { PrepareStrategy } from './prepare/prepare.strategy';

export enum PayoutStrategyAlias {
  DEFICHAIN_DFI_STRATEGY = 'DeFiChainDFIStrategy',
  DEFICHAIN_TOKEN_STRATEGY = 'DeFiChainTokenStrategy',
  ETHEREUM_STRATEGY = 'EthereumStrategy',
}

export enum PrepareStrategyAlias {
  DEFICHAIN_STRATEGY = 'DeFiChainStrategy',
  ETHEREUM_STRATEGY = 'EthereumStrategy',
}

export interface PayoutStrategyQuery {
  blockchain?: Blockchain | 'default';
  assetName?: string | 'default';
}

export interface PrepareStrategyQuery {
  blockchain?: Blockchain | 'default';
}

@Injectable()
export class PayoutStrategiesFacade {
  private readonly payoutStrategies: Map<PayoutStrategyAlias, PayoutStrategy> = new Map();
  private readonly prepareStrategies: Map<PrepareStrategyAlias, PrepareStrategy> = new Map();

  constructor(
    readonly payoutDFIStrategy: PayoutDFIStrategy,
    readonly payoutTokenStrategy: PayoutTokenStrategy,
    readonly payoutETHStrategy: PayoutETHStrategy,
    readonly prepareOnDefichainStrategy: PrepareOnDefichainStrategy,
    readonly prepareOnEthereumStrategy: PrepareOnEthereumStrategy,
  ) {
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_DFI_STRATEGY, payoutDFIStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_TOKEN_STRATEGY, payoutTokenStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.ETHEREUM_STRATEGY, payoutETHStrategy);

    this.prepareStrategies.set(PrepareStrategyAlias.DEFICHAIN_STRATEGY, prepareOnDefichainStrategy);
    this.prepareStrategies.set(PrepareStrategyAlias.ETHEREUM_STRATEGY, prepareOnEthereumStrategy);
  }

  getPayoutStrategy(criteria: Asset | PayoutStrategyAlias): PayoutStrategy {
    return criteria instanceof Asset
      ? this.getPayoutStrategyByAsset(criteria)
      : this.getPayoutStrategyByAlias(criteria);
  }

  getPrepareStrategy(criteria: Asset | PrepareStrategyAlias): PrepareStrategy {
    return criteria instanceof Asset
      ? this.getPrepareStrategyByAsset(criteria)
      : this.getPrepareStrategyByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getPayoutStrategyByAlias(alias: PayoutStrategyAlias): PayoutStrategy {
    const strategy = this.payoutStrategies.get(alias);

    if (!strategy) throw new Error(`No PayoutStrategy found. Alias: ${JSON.stringify(alias)}`);

    return strategy;
  }

  private getPayoutStrategyByAsset(asset: Asset): PayoutStrategy {
    const alias = this.getPayoutStrategyAlias(asset);

    return this.getPayoutStrategyByAlias(alias);
  }

  private getPrepareStrategyByAlias(alias: PrepareStrategyAlias): PrepareStrategy {
    const strategy = this.prepareStrategies.get(alias);

    if (!strategy) throw new Error(`No PrepareStrategy found. Alias: ${JSON.stringify(alias)}`);

    return strategy;
  }

  private getPrepareStrategyByAsset(asset: Asset): PrepareStrategy {
    const alias = this.getPrepareStrategyAlias(asset);

    return this.getPrepareStrategyByAlias(alias);
  }

  private getPayoutStrategyAlias(asset: Asset): PayoutStrategyAlias {
    const { blockchain, dexName: assetName } = asset;

    if (blockchain === Blockchain.ETHEREUM) return PayoutStrategyAlias.ETHEREUM_STRATEGY;
    if (assetName === 'DFI') return PayoutStrategyAlias.DEFICHAIN_DFI_STRATEGY;
    return PayoutStrategyAlias.DEFICHAIN_TOKEN_STRATEGY;
  }

  private getPrepareStrategyAlias(asset: Asset): PrepareStrategyAlias {
    const { blockchain } = asset;

    if (blockchain === Blockchain.ETHEREUM) return PrepareStrategyAlias.ETHEREUM_STRATEGY;
    return PrepareStrategyAlias.DEFICHAIN_STRATEGY;
  }
}
