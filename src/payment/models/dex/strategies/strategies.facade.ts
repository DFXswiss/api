import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityBSCStrategy } from './check-liquidity/check-liquidity-bsc.strategy';
import { CheckLiquidityDeFiChainDefaultStrategy } from './check-liquidity/check-liquidity-defichain-default.strategy';
import { CheckLiquidityEthereumStrategy } from './check-liquidity/check-liquidity-ethereum.strategy';
import { CheckLiquidityStrategy } from './check-liquidity/base/check-liquidity.strategy';
import { CheckLiquidityDeFiChainPoolPairStrategy } from './check-liquidity/check-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityBSCStrategy } from './purchase-liquidity/purchase-liquidity-bsc.strategy';
import { PurchaseLiquidityDeFiChainCryptoStrategy } from './purchase-liquidity/purchase-liquidity-defichain-crypto.strategy';
import { PurchaseLiquidityEthereumStrategy } from './purchase-liquidity/purchase-liquidity-ethereum.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity/base/purchase-liquidity.strategy';
import { PurchaseLiquidityDeFiChainPoolPairStrategy } from './purchase-liquidity/purchase-liquidity-defichain-poolpair.strategy';
import { PurchaseLiquidityDeFiChainStockStrategy } from './purchase-liquidity/purchase-liquidity-defichain-stock.strategy';

export enum CheckLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BSCDefault',
}

export enum PurchaseLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  ETHEREUM_DEFAULT = 'EthereumDefault',
  BSC_DEFAULT = 'BSCDefault',
}

@Injectable()
export class DexStrategiesFacade {
  private readonly checkLiquidityStrategies = new Map<CheckLiquidityStrategyAlias, CheckLiquidityStrategy>();
  private readonly purchaseLiquidityStrategies = new Map<PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategy>();

  constructor(
    checkLiquidityDeFiChainPoolPairStrategy: CheckLiquidityDeFiChainPoolPairStrategy,
    checkLiquidityDeFiChainDefaultStrategy: CheckLiquidityDeFiChainDefaultStrategy,
    checkLiquidityEthereumStrategy: CheckLiquidityEthereumStrategy,
    checkLiquidityBSCStrategy: CheckLiquidityBSCStrategy,
    @Inject(forwardRef(() => PurchaseLiquidityDeFiChainPoolPairStrategy))
    purchaseLiquidityDeFiChainPoolPairStrategy: PurchaseLiquidityDeFiChainPoolPairStrategy,
    purchaseLiquidityDeFiChainStockStrategy: PurchaseLiquidityDeFiChainStockStrategy,
    purchaseLiquidityDeFiChainCryptoStrategy: PurchaseLiquidityDeFiChainCryptoStrategy,
    purchaseLiquidityEthereumStrategy: PurchaseLiquidityEthereumStrategy,
    purchaseLiquidityBSCStrategy: PurchaseLiquidityBSCStrategy,
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

    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.BSC_DEFAULT, checkLiquidityBSCStrategy);

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

    this.purchaseLiquidityStrategies.set(PurchaseLiquidityStrategyAlias.BSC_DEFAULT, purchaseLiquidityBSCStrategy);
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

    if (!strategy) throw new Error(`No CheckLiquidityStrategy found. Alias: ${JSON.stringify(alias)}`);

    return strategy;
  }

  private getCheckLiquidityStrategyByAsset(asset: Asset): CheckLiquidityStrategy {
    const alias = this.getCheckLiquidityStrategyAlias(asset);

    return this.getCheckLiquidityStrategyByAlias(alias);
  }

  private getPurchaseLiquidityStrategyByAlias(alias: PurchaseLiquidityStrategyAlias): PurchaseLiquidityStrategy {
    const strategy = this.purchaseLiquidityStrategies.get(alias);

    if (!strategy) throw new Error(`No PurchaseLiquidityStrategy found. Alias: ${JSON.stringify(alias)}`);

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
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT;
  }

  private getPurchaseLiquidityStrategyAlias(asset: Asset): PurchaseLiquidityStrategyAlias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK;
      if (assetCategory === AssetCategory.CRYPTO) return PurchaseLiquidityStrategyAlias.BSC_DEFAULT;
    }

    if (blockchain === Blockchain.ETHEREUM) return PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT;
    if (blockchain === Blockchain.BINANCE_SMART_CHAIN) return PurchaseLiquidityStrategyAlias.BSC_DEFAULT;
  }
}
