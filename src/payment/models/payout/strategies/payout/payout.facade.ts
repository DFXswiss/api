import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutStrategy } from './impl/base/payout.strategy';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { DeFiChainDfiStrategy } from './impl/defichain-dfi.strategy';
import { DeFiChainTokenStrategy } from './impl/defichain-token.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';

enum Alias {
  DEFICHAIN_DFI = 'DeFiChainDFI',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_DEFAULT = 'Ethereum',
  BSC_DEFAULT = 'BscDefault',
}

export { Alias as PayoutStrategyAlias };

@Injectable()
export class PayoutStrategiesFacade {
  protected readonly strategies: Map<Alias, PayoutStrategy> = new Map();

  constructor(
    deFiChainDfi: DeFiChainDfiStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    bscCrypto: BscCryptoStrategy,
  ) {
    this.strategies.set(Alias.DEFICHAIN_DFI, deFiChainDfi);
    this.strategies.set(Alias.DEFICHAIN_TOKEN, deFiChainToken);
    this.strategies.set(Alias.ETHEREUM_DEFAULT, ethereumCrypto);
    this.strategies.set(Alias.BSC_DEFAULT, bscCrypto);
  }

  getPayoutStrategy(criteria: Asset | Alias): PayoutStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): PayoutStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PayoutStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): PayoutStrategy {
    const alias = this.getAlias(asset);

    return this.getByAlias(alias);
  }

  private getAlias(asset: Asset): Alias {
    const { blockchain, dexName: assetName } = asset;

    if (blockchain === Blockchain.ETHEREUM) return Alias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return Alias.BSC_DEFAULT;
    if (blockchain === Blockchain.DEFICHAIN && assetName === 'DFI') return Alias.DEFICHAIN_DFI;
    if ((blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) && assetName !== 'DFI') {
      return Alias.DEFICHAIN_TOKEN;
    }
  }
}
