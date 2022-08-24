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
  DEFICHAIN_DFI = 'DeFiChainDFI',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_DEFAULT = 'Ethereum',
}

export enum PrepareStrategyAlias {
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
}

@Injectable()
export class PayoutStrategiesFacade {
  private readonly payoutStrategies: Map<PayoutStrategyAlias, PayoutStrategy> = new Map();
  private readonly prepareStrategies: Map<PrepareStrategyAlias, PrepareStrategy> = new Map();

  constructor(
    payoutDFIStrategy: PayoutDFIStrategy,
    payoutTokenStrategy: PayoutTokenStrategy,
    payoutETHStrategy: PayoutETHStrategy,
    prepareOnDefichainStrategy: PrepareOnDefichainStrategy,
    prepareOnEthereumStrategy: PrepareOnEthereumStrategy,
  ) {
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_DFI, payoutDFIStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_TOKEN, payoutTokenStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.ETHEREUM_DEFAULT, payoutETHStrategy);

    this.prepareStrategies.set(PrepareStrategyAlias.DEFICHAIN, prepareOnDefichainStrategy);
    this.prepareStrategies.set(PrepareStrategyAlias.ETHEREUM, prepareOnEthereumStrategy);
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

    if (blockchain === Blockchain.ETHEREUM) return PayoutStrategyAlias.ETHEREUM_DEFAULT;
    if (assetName === 'DFI') return PayoutStrategyAlias.DEFICHAIN_DFI;
    return PayoutStrategyAlias.DEFICHAIN_TOKEN;
  }

  private getPrepareStrategyAlias(asset: Asset): PrepareStrategyAlias {
    const { blockchain } = asset;

    if (blockchain === Blockchain.ETHEREUM) return PrepareStrategyAlias.ETHEREUM;
    return PrepareStrategyAlias.DEFICHAIN;
  }
}
