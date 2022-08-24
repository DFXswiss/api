import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityDefaultStrategy } from './check-liquidity/check-liquidity-default.strategy';
import { CheckEthereumLiquidityStrategy } from './check-liquidity/check-liquidity-ethereum.strategy';
import { CheckLiquidityStrategy } from './check-liquidity/check-liquidity.strategy';
import { CheckPoolPairLiquidityStrategy } from './check-liquidity/check-poolpair-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from './purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchaseETHLiquidityStrategy } from './purchase-liquidity/purchase-eth-liquiduity.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity/purchase-liquidity.strategy';
import { PurchasePoolPairLiquidityStrategy } from './purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './purchase-liquidity/purchase-stock-liquidity.strategy';

export enum CheckLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_DEFAULT = 'DeFiChainDefault',
  ETHEREUM_DEFAULT = 'EthereumDefault',
}

export enum PurchaseLiquidityStrategyAlias {
  DEFICHAIN_POOL_PAIR = 'DeFiChainPoolPair',
  DEFICHAIN_STOCK = 'DeFiChainStock',
  DEFICHAIN_CRYPTO = 'DeFiChainCrypto',
  ETHEREUM_DEFAULT = 'EthereumDefault',
}

@Injectable()
export class DexStrategiesFacade {
  private readonly checkLiquidityStrategies = new Map<CheckLiquidityStrategyAlias, CheckLiquidityStrategy>();
  private readonly purchaseLiquidityStrategies = new Map<PurchaseLiquidityStrategyAlias, PurchaseLiquidityStrategy>();

  constructor(
    checkPoolPairLiquidityStrategy: CheckPoolPairLiquidityStrategy,
    checkLiquidityDefaultStrategy: CheckLiquidityDefaultStrategy,
    checkEthereumLiquidityStrategy: CheckEthereumLiquidityStrategy,
    @Inject(forwardRef(() => PurchasePoolPairLiquidityStrategy))
    purchasePoolPairLiquidityStrategy: PurchasePoolPairLiquidityStrategy,
    purchaseStockLiquidityStrategy: PurchaseStockLiquidityStrategy,
    purchaseCryptoLiquidityStrategy: PurchaseCryptoLiquidityStrategy,
    purchaseEthLiquidityStrategy: PurchaseETHLiquidityStrategy,
  ) {
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR, checkPoolPairLiquidityStrategy);
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT, checkLiquidityDefaultStrategy);
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT, checkEthereumLiquidityStrategy);

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR,
      purchasePoolPairLiquidityStrategy,
    );

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK,
      purchaseStockLiquidityStrategy,
    );

    this.purchaseLiquidityStrategies.set(
      PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO,
      purchaseCryptoLiquidityStrategy,
    );

    this.purchaseLiquidityStrategies.set(PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT, purchaseEthLiquidityStrategy);
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
  }

  private getPurchaseLiquidityStrategyAlias(asset: Asset): PurchaseLiquidityStrategyAlias {
    const { blockchain, category: assetCategory } = asset;

    if (blockchain === Blockchain.DEFICHAIN || blockchain === Blockchain.BITCOIN) {
      if (assetCategory === AssetCategory.POOL_PAIR) return PurchaseLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR;
      if (assetCategory === AssetCategory.STOCK) return PurchaseLiquidityStrategyAlias.DEFICHAIN_STOCK;
      if (assetCategory === AssetCategory.CRYPTO) return PurchaseLiquidityStrategyAlias.DEFICHAIN_CRYPTO;
    }

    if (blockchain === Blockchain.ETHEREUM) return PurchaseLiquidityStrategyAlias.ETHEREUM_DEFAULT;
  }
}
