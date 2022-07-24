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

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { referenceAsset, referenceAmount, targetAsset } = request;

    return this.swapLiquidityService.tryAssetSwap(
      referenceAsset,
      referenceAmount,
      targetAsset.dexName,
      LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
    );
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const strategy = this.#purchaseLiquidityStrategies.get(request?.targetAsset?.category);

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
