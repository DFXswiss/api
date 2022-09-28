import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBscCryptoStrategy } from './payout/payout-bsc-crypto.strategy';
import { PayoutDeFiChainDFIStrategy } from './payout/payout-defichain-dfi.strategy';
import { PayoutEthereumCryptoStrategy } from './payout/payout-ethereum-crypto.strategy';
import { PayoutDeFiChainTokenStrategy } from './payout/payout-defichain-token.strategy';
import { PayoutStrategy } from './payout/base/payout.strategy';
import { PrepareBscStrategy } from './prepare/prepare-bsc.strategy';
import { PrepareDeFiChainStrategy } from './prepare/prepare-defichain.strategy';
import { PrepareEthereumStrategy } from './prepare/prepare-ethereum.strategy';
import { PrepareStrategy } from './prepare/base/prepare.strategy';

export enum PayoutStrategyAlias {
  DEFICHAIN_DFI = 'DeFiChainDFI',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_DEFAULT = 'Ethereum',
  BSC_DEFAULT = 'BscDefault',
}

export enum PrepareStrategyAlias {
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
  BSC = 'Bsc',
}

@Injectable()
export class PayoutStrategiesFacade {
  protected readonly payoutStrategies: Map<PayoutStrategyAlias, PayoutStrategy> = new Map();
  protected readonly prepareStrategies: Map<PrepareStrategyAlias, PrepareStrategy> = new Map();

  constructor(
    payoutDFIStrategy: PayoutDeFiChainDFIStrategy,
    payoutTokenStrategy: PayoutDeFiChainTokenStrategy,
    payoutEthStrategy: PayoutEthereumCryptoStrategy,
    payoutBscStrategy: PayoutBscCryptoStrategy,
    prepareOnDefichainStrategy: PrepareDeFiChainStrategy,
    prepareOnEthereumStrategy: PrepareEthereumStrategy,
    prepareOnBscStrategy: PrepareBscStrategy,
  ) {
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_DFI, payoutDFIStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.DEFICHAIN_TOKEN, payoutTokenStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.ETHEREUM_DEFAULT, payoutEthStrategy);
    this.payoutStrategies.set(PayoutStrategyAlias.BSC_DEFAULT, payoutBscStrategy);

    this.prepareStrategies.set(PrepareStrategyAlias.DEFICHAIN, prepareOnDefichainStrategy);
    this.prepareStrategies.set(PrepareStrategyAlias.ETHEREUM, prepareOnEthereumStrategy);
    this.prepareStrategies.set(PrepareStrategyAlias.BSC, prepareOnBscStrategy);
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

    if (!strategy) throw new Error(`No PayoutStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getPayoutStrategyByAsset(asset: Asset): PayoutStrategy {
    const alias = this.getPayoutStrategyAlias(asset);

    return this.getPayoutStrategyByAlias(alias);
  }

  private getPrepareStrategyByAlias(alias: PrepareStrategyAlias): PrepareStrategy {
    const strategy = this.prepareStrategies.get(alias);

    if (!strategy) throw new Error(`No PrepareStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getPrepareStrategyByAsset(asset: Asset): PrepareStrategy {
    const alias = this.getPrepareStrategyAlias(asset);

    return this.getPrepareStrategyByAlias(alias);
  }

  private getPayoutStrategyAlias(asset: Asset): PayoutStrategyAlias {
    const { blockchain, dexName: assetName } = asset;

    if (blockchain === Blockchain.ETHEREUM) return PayoutStrategyAlias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return PayoutStrategyAlias.BSC_DEFAULT;
    if (blockchain === Blockchain.DEFICHAIN && assetName === 'DFI') return PayoutStrategyAlias.DEFICHAIN_DFI;
    if ((blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) && assetName !== 'DFI') {
      return PayoutStrategyAlias.DEFICHAIN_TOKEN;
    }
  }

  private getPrepareStrategyAlias(asset: Asset): PrepareStrategyAlias {
    const { blockchain } = asset;

    if (blockchain === Blockchain.ETHEREUM) return PrepareStrategyAlias.ETHEREUM;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return PrepareStrategyAlias.BSC;
    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) return PrepareStrategyAlias.DEFICHAIN;
  }
}
