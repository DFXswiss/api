import { Injectable } from '@nestjs/common';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { PurchasePoolPairLiquidityStrategy } from './purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from './purchase-stock-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from './purchase-crypto-liquidity.strategy';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';
import { LiquidityOrderFactory } from '../../factories/liquidity-order.factory';
import { LiquidityOrderContext } from '../../entities/liquidity-order.entity';

export interface PurchaseLiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: string;
  referenceAmount: number;
  targetAsset: Asset;
}

@Injectable()
export class PurchaseLiquidityFacade {
  #strategies = new Map<AssetCategory, PurchaseLiquidityStrategy>();

  constructor(
    readonly liquidityOrderFactory: LiquidityOrderFactory,
    readonly poolPairStrategy: PurchasePoolPairLiquidityStrategy,
    readonly stockStrategy: PurchaseStockLiquidityStrategy,
    readonly cryptoStrategy: PurchaseCryptoLiquidityStrategy,
  ) {
    this.#strategies.set(AssetCategory.POOL_PAIR, poolPairStrategy);
    this.#strategies.set(AssetCategory.STOCK, stockStrategy);
    this.#strategies.set(AssetCategory.CRYPTO, cryptoStrategy);
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    // throw generic error here
    const strategy = this.#strategies.get(request?.targetAsset?.category);

    if (!strategy) {
      throw new Error(`No purchase liquidity strategy for asset category ${request?.targetAsset?.category}`);
    }

    try {
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      console.error(e);
      throw new Error(
        `Error while purchasing liquidity. Context: ${request.context}. Correlation ID: ${request.correlationId}. `,
      );
    }
  }
}
