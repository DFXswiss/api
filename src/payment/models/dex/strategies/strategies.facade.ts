import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityBscCryptoStrategy } from './check-liquidity/check-liquidity-bsc-crypto.strategy';
import { CheckLiquidityDeFiChainDefaultStrategy } from './check-liquidity/check-liquidity-defichain-default.strategy';
import { CheckLiquidityEthereumCryptoStrategy } from './check-liquidity/check-liquidity-ethereum-crypto.strategy';
import { CheckLiquidityStrategy } from './check-liquidity/base/check-liquidity.strategy';
import { CheckLiquidityDeFiChainPoolPairStrategy } from './check-liquidity/check-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityBscCryptoStrategy } from './purchase-liquidity/purchase-liquidity-bsc-crypto.strategy';
import { PurchaseLiquidityDeFiChainCryptoStrategy } from './purchase-liquidity/purchase-liquidity-defichain-crypto.strategy';
import { PurchaseLiquidityEthereumCryptoStrategy } from './purchase-liquidity/purchase-liquidity-ethereum-crypto.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity/base/purchase-liquidity.strategy';
import { PurchaseLiquidityDeFiChainPoolPairStrategy } from './purchase-liquidity/purchase-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityDeFiChainStockStrategy } from './purchase-liquidity/purchase-liquidity-defichain-stock.strategy';

export enum CheckLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BscDefault',
}

export enum PurchaseLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BscDefault',
}

@Injectable()
export class DexStrategiesFacade {
  protected readonly checkLiquidityStrategies = new Map<CheckLiquidityStrategyAlias, CheckLiquidityStrategy>();
  protected readonly purchaseLiquidityStrategies = new Map<PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategy>();

  constructor(
    checkLiquidityDeFiChainPoolPairStrategy: CheckLiquidityDeFiChainPoolPairStrategy,
    checkLiquidityDeFiChainDefaultStrategy: CheckLiquidityDeFiChainDefaultStrategy,
    checkLiquidityEthereumStrategy: CheckLiquidityEthereumCryptoStrategy,
    checkLiquidityBscStrategy: CheckLiquidityBscCryptoStrategy,
    @Inject(forwardRef(() => PurchaseLiquidityDeFiChainPoolPairStrategy))
    purchaseLiquidityDeFiChainPoolPairStrategy: PurchaseLiquidityDeFiChainPoolPairStrategy,
    purchaseLiquidityDeFiChainStockStrategy: PurchaseLiquidityDeFiChainStockStrategy,
    purchaseLiquidityDeFiChainCryptoStrategy: PurchaseLiquidityDeFiChainCryptoStrategy,
    purchaseLiquidityEthereumStrategy: PurchaseLiquidityEthereumCryptoStrategy,
    purchaseLiquidityBscStrategy: PurchaseLiquidityBscCryptoStrategy,
  ) {
    this.checkLiquidityStrategies.set(
      CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR,
      checkLiquidityDeFiChainPoolPairStrategy,
    );

    this.checkLiquidityStrategies.set(
      CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT,
      checkLiquidityDeFiChainDefaultStrategy,
    );

    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT, checkLiquidityEthereumStrategy);

    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.BSC_DEFAULT, checkLiquidityBscStrategy);

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR,
      purchaseLiquidityDeFiChainPoolPairStrategy,
    );

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK,
      purchaseLiquidityDeFiChainStockStrategy,
    );

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO,
      purchaseLiquidityDeFiChainCryptoStrategy,
    );

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT,
      purchaseLiquidityEthereumStrategy,
    );

    this.purchaseLiquidityStrategies.set(PurchaseLiquidityStrategyAlias.BSC_DEFAULT, purchaseLiquidityBscStrategy);
  }

  getCheckLiquidityStrategy(criteria: Asset | CheckLiquidityStrategyAlias): CheckLiquidityStrategy {
    return criteria instanceof Asset
      ? this.getCheckLiquidityStrategyByAsset(criteria)
      : this.getCheckLiquidityStrategyByAlias(criteria);
  }

  getPurchaseLiquidityStrategy(criteria: Asset | PurchaseLiquidityStrategyAlias): PurchaseLiquidityStrategy {
    return criteria instanceof Asset
      ? this.getPurchaseLiquidityStrategyByAsset(criteria)
      : this.getPurchaseLiquidityStrategyByAlias(criteria);
  }

  //*** HELPER METHODS ***//

  private getCheckLiquidityStrategyByAlias(alias: CheckLiquidityStrategyAlias): CheckLiquidityStrategy {
    const strategy = this.checkLiquidityStrategies.get(alias);

    if (!strategy) throw new Error(`No CheckLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getCheckLiquidityStrategyByAsset(asset: Asset): CheckLiquidityStrategy {
    const alias = this.getCheckLiquidityStrategyAlias(asset);

    return this.getCheckLiquidityStrategyByAlias(alias);
  }

  private getPurchaseLiquidityStrategyByAlias(alias: PurchaseLiquidityStrategyAlias): PurchaseLiquidityStrategy {
    const strategy = this.purchaseLiquidityStrategies.get(alias);

    if (!strategy) throw new Error(`No PurchaseLiquidityStrategy found. Alias: ${alias}`);

    return strategy;
  }

  private getPurchaseLiquidityStrategyByAsset(asset: Asset): PurchaseLiquidityStrategy {
    const alias = this.getPurchaseLiquidityStrategyAlias(asset);

    return this.getPurchaseLiquidityStrategyByAlias(alias);
  }

  private getCheckLiquidityStrategyAlias(asset: Asset): CheckLiquidityStrategyAlias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR;
      return CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT;
    }

    if (blockchain === Blockchain.ETHEREUM) return CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return CheckLiquidityStrategyAlias.BSC_DEFAULT;
  }

  private getPurchaseLiquidityStrategyAlias(asset: Asset): PurchaseLiquidityStrategyAlias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK;
      if (assetCategory === AssetCategory.CRYPTO) return PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO;
    }

    if (blockchain === Blockchain.ETHEREUM) return PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return PurchaseLiquidityStrategyAlias.BSC_DEFAULT;
  }
}
