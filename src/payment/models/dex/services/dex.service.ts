import { Injectable } from '@nestjs/common';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { PurchasePoolPairLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-stock-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchaseLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-liquidity.strategy';
import { LiquidityOrder, LiquidityOrderContext } from '../entities/liquidity-order.entity';
import { SwapLiquidityService } from './swap-liquidity.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';

export interface LiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: string;
  referenceAmount: number;
  targetAsset: Asset;
}

@Injectable()
export class DEXService {
  #purchaseLiquidityStrategies = new Map<AssetCategory, PurchaseLiquidityStrategy>();

  constructor(
    private readonly swapLiquidityService: SwapLiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    readonly poolPairStrategy: PurchasePoolPairLiquidityStrategy,
    readonly stockStrategy: PurchaseStockLiquidityStrategy,
    readonly cryptoStrategy: PurchaseCryptoLiquidityStrategy,
  ) {
    this.#purchaseLiquidityStrategies.set(AssetCategory.POOL_PAIR, poolPairStrategy);
    this.#purchaseLiquidityStrategies.set(AssetCategory.STOCK, stockStrategy);
    this.#purchaseLiquidityStrategies.set(AssetCategory.CRYPTO, cryptoStrategy);
  }

  // *** PUBLIC API *** //

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    try {
      return this.swapLiquidityService.tryAssetSwap(
        referenceAsset,
        referenceAmount,
        targetAsset.dexName,
        LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      );
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) return 0;
      if (e instanceof PriceSlippageException) throw e;

      // default public exception
      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { context, correlationId, targetAsset } = request;
    const strategy = this.#purchaseLiquidityStrategies.get(targetAsset?.category);

    if (!strategy) {
      throw new Error(`No purchase liquidity strategy for asset category ${targetAsset?.category}`);
    }

    try {
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      console.error(e);

      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;

      // default public exception
      throw new Error(`Error while purchasing liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async fetchPurchasedLiquidity(context: LiquidityOrderContext, correlationId: string): Promise<number> {
    const order = await this.liquidityOrderRepo.findOne({ where: { context, correlationId } });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.targetAmount;
  }
}
