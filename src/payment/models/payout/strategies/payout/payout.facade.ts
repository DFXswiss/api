import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { PayoutStrategy } from './impl/base/payout.strategy';
import { BitcoinStrategy } from './impl/bitcoin.strategy';
import { BscCryptoStrategy } from './impl/bsc-crypto.strategy';
import { BscTokenStrategy } from './impl/bsc-token.strategy';
import { DeFiChainDfiStrategy } from './impl/defichain-dfi.strategy';
import { DeFiChainTokenStrategy } from './impl/defichain-token.strategy';
import { EthereumCryptoStrategy } from './impl/ethereum-crypto.strategy';
import { EthereumTokenStrategy } from './impl/ethereum-token.strategy';

enum Alias {
  BITCOIN = 'Bitcoin',
  BSC_CRYPTO = 'BscCrypto',
  BSC_TOKEN = 'BscToken',
  DEFICHAIN_DFI = 'DeFiChainDFI',
  DEFICHAIN_TOKEN = 'DeFiChainToken',
  ETHEREUM_CRYPTO = 'EthereumCrypto',
  ETHEREUM_TOKEN = 'EthereumToken',
}

export { Alias as PayoutStrategyAlias };

@Injectable()
export class PayoutStrategiesFacade {
  protected readonly strategies: Map<Alias, PayoutStrategy> = new Map();

  constructor(
    bitcoin: BitcoinStrategy,
    bscCrypto: BscCryptoStrategy,
    bscToken: BscTokenStrategy,
    deFiChainDfi: DeFiChainDfiStrategy,
    deFiChainToken: DeFiChainTokenStrategy,
    ethereumCrypto: EthereumCryptoStrategy,
    ethereumToken: EthereumTokenStrategy,
  ) {
    this.strategies.set(Alias.BITCOIN, bitcoin);
    this.strategies.set(Alias.BSC_CRYPTO, bscCrypto);
    this.strategies.set(Alias.BSC_TOKEN, bscToken);
    this.strategies.set(Alias.DEFICHAIN_DFI, deFiChainDfi);
    this.strategies.set(Alias.DEFICHAIN_TOKEN, deFiChainToken);
    this.strategies.set(Alias.ETHEREUM_CRYPTO, ethereumCrypto);
    this.strategies.set(Alias.ETHEREUM_TOKEN, ethereumToken);
  }

  getPayoutStrategy(criteria: Asset | Alias): PayoutStrategy {
    return criteria instanceof Asset ? this.getByAsset(criteria) : this.getByAlias(criteria);
  }

  getPayoutStrategyAlias(asset: Asset): Alias {
    const { blockchain, dexName: assetName, category: assetCategory } = asset;

    if (blockchain === Blockchain.BITCOIN) return Alias.BITCOIN;

    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) {
      if (assetCategory === AssetCategory.CRYPTO) return Alias.BSC_CRYPTO;
      if (assetCategory === AssetCategory.STOCK) return Alias.BSC_TOKEN;
    }

    if (blockchain === Blockchain.DEFICHAIN) {
      if (assetName === 'DFI') {
        return Alias.DEFICHAIN_DFI;
      } else {
        return Alias.DEFICHAIN_TOKEN;
      }
    }

    if (blockchain === Blockchain.ETHEREUM) {
      if (assetCategory === AssetCategory.CRYPTO) return Alias.ETHEREUM_CRYPTO;
      if (assetCategory === AssetCategory.STOCK) return Alias.ETHEREUM_TOKEN;
    }
  }

  //*** HELPER METHODS ***//

  private getByAlias(alias: Alias): PayoutStrategy {
    const strategy = this.strategies.get(alias);

    if (!strategy) throw new Error(`No PayoutStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getByAsset(asset: Asset): PayoutStrategy {
    const alias = this.getPayoutStrategyAlias(asset);

    return this.getByAlias(alias);
  }
}
