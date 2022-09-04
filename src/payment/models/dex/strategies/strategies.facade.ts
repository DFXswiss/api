import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityBSCStrategy } from './check-liquidity/check-liquidity-bsc.strategy';
import { CheckLiquidityDefaultStrategy } from './check-liquidity/check-liquidity-default.strategy';
import { CheckLiquidityETHStrategy } from './check-liquidity/check-liquidity-eth.strategy';
import { CheckLiquidityStrategy } from './check-liquidity/base/check-liquidity.strategy';
import { CheckPoolPairLiquidityStrategy } from './check-liquidity/check-poolpair-liquidity.strategy';
import { PurchaseBSCLiquidityStrategy } from './purchase-liquidity/purchase-bsc-liquiduity.strategy';
import { PurchaseCryptoLiquidityStrategy } from './purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchaseETHLiquidityStrategy } from './purchase-liquidity/purchase-eth-liquiduity.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity/purchase-liquidity.strategy';
import { PurchasePoolPairLiquidityStrategy } from './purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './purchase-liquidity/purchase-stock-liquidity.strategy';

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
    checkPoolPairLiquidityStrategy: CheckPoolPairLiquidityStrategy,
    checkLiquidityDefaultStrategy: CheckLiquidityDefaultStrategy,
    checkEthLiquidityStrategy: CheckLiquidityETHStrategy,
    checkBscLiquidityStrategy: CheckLiquidityBSCStrategy,
    @Inject(forwardRef(() => PurchasePoolPairLiquidityStrategy))
    purchasePoolPairLiquidityStrategy: PurchasePoolPairLiquidityStrategy,
    purchaseStockLiquidityStrategy: PurchaseStockLiquidityStrategy,
    purchaseCryptoLiquidityStrategy: PurchaseCryptoLiquidityStrategy,
    purchaseEthLiquidityStrategy: PurchaseETHLiquidityStrategy,
    purchaseBscLiquidityStrategy: PurchaseBSCLiquidityStrategy,
  ) {
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.DEFICHAIN_POOL_PAIR, checkPoolPairLiquidityStrategy);
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.DEFICHAIN_DEFAULT, checkLiquidityDefaultStrategy);
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.ETHEREUM_DEFAULT, checkEthLiquidityStrategy);
    this.checkLiquidityStrategies.set(CheckLiquidityStrategyAlias.BSC_DEFAULT, checkBscLiquidityStrategy);

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
    this.purchaseLiquidityStrategies.set(PurchaseLiquidityStrategyAlias.BSC_DEFAULT, purchaseBscLiquidityStrategy);
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
