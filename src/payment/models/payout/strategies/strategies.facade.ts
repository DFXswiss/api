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
  DFI_STRATEGY = 'DFIStrategy',
  DEFICHAIN_TOKEN_STRATEGY = 'DeFiChainTokenStrategy',
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
  private readonly payoutStrategies: [PayoutStrategyQuery, PayoutStrategy][] = [];
  private readonly prepareStrategies: [PrepareStrategyQuery, PrepareStrategy][] = [];

  constructor(
    readonly payoutDFIStrategy: PayoutDFIStrategy,
    readonly payoutTokenStrategy: PayoutTokenStrategy,
    readonly payoutETHStrategy: PayoutETHStrategy,
    readonly prepareOnDefichainStrategy: PrepareOnDefichainStrategy,
    readonly prepareOnEthereumStrategy: PrepareOnEthereumStrategy,
  ) {
    this.payoutStrategies.push([{ blockchain: 'default', assetName: 'DFI' }, payoutDFIStrategy]);
    this.payoutStrategies.push([{ blockchain: 'default', assetName: 'default' }, payoutTokenStrategy]);
    this.payoutStrategies.push([{ blockchain: Blockchain.ETHEREUM, assetName: 'ETH' }, payoutETHStrategy]);

    this.prepareStrategies.push([{ blockchain: 'default' }, prepareOnDefichainStrategy]);
    this.prepareStrategies.push([{ blockchain: Blockchain.ETHEREUM }, prepareOnEthereumStrategy]);
  }

  getPayoutStrategy(criteria: Asset | PayoutStrategyQuery): PayoutStrategy {
    return criteria instanceof Asset
      ? this.getPayoutStrategyByAsset(criteria)
      : this.getPayoutStrategyByQuery(criteria);
  }

  getPrepareStrategy(criteria: Asset | PrepareStrategyQuery): PrepareStrategy {
    return criteria instanceof Asset
      ? this.getPrepareStrategyByAsset(criteria)
      : this.getPrepareStrategyByQuery(criteria);
  }

  private getPayoutStrategyByQuery(query: PayoutStrategyQuery): PayoutStrategy {
    const { blockchain, assetName } = query;

    const strategiesForBlockchain = this.payoutStrategies.filter(
      (s) => s[0].blockchain === blockchain || (Array.isArray(s[0].blockchain) && s[0].blockchain.includes(blockchain)),
    );

    const strategyTuple =
      strategiesForBlockchain.find((s) => s[0].assetName === assetName) ||
      strategiesForBlockchain.find((s) => s[0].assetName === 'default');

    if (!strategyTuple) throw new Error(`No PayoutStrategy found. Query: ${JSON.stringify(query)}`);

    return strategyTuple[1];
  }

  private getPayoutStrategyByAsset(asset: Asset): PayoutStrategy {
    const { blockchain, dexName: assetName, category: assetCategory } = asset;
  }

  private getPrepareStrategyByQuery(query: PrepareStrategyQuery): PrepareStrategy {
    const { blockchain } = query;

    const strategyTuple = this.prepareStrategies.find((s) => s[0].blockchain === blockchain);

    if (!strategyTuple) throw new Error(`No PrepareStrategy found. Query: ${JSON.stringify(query)}`);

    return strategyTuple[1];
  }

  private getPrepareStrategyByAsset(asset: Asset): PrepareStrategy {}
}
