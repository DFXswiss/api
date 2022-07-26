import { Injectable } from '@nestjs/common';
import { Asset, AssetCategory } from 'src/shared/models/asset/asset.entity';
import { PurchasePoolPairLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-poolpair-liquidity.strategy';
import { PurchaseStockLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-stock-liquidity.strategy';
import { PurchaseCryptoLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-crypto-liquidity.strategy';
import { PurchaseLiquidityStrategy } from '../strategies/purchase-liquidity/purchase-liquidity.strategy';
import { LiquidityOrder, LiquidityOrderContext } from '../entities/liquidity-order.entity';
import { LiquidityService } from './liquidity.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/lock';
import { Not, IsNull } from 'typeorm';
import { LiquidityOrderFactory } from '../factories/liquidity-order.factory';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { MailService } from 'src/shared/services/mail.service';

export interface LiquidityRequest {
  context: LiquidityOrderContext;
  correlationId: string;
  referenceAsset: string;
  referenceAmount: number;
  targetAsset: Asset;
}

@Injectable()
export class DEXService {
  private readonly verifyPurchaseOrdersLock = new Lock(1800);

  #purchaseLiquidityStrategies = new Map<AssetCategory, PurchaseLiquidityStrategy>();

  constructor(
    readonly mailService: MailService,
    readonly settingService: SettingService,
    readonly assetService: AssetService,
    private readonly liquidityService: LiquidityService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    this.#purchaseLiquidityStrategies.set(
      AssetCategory.POOL_PAIR,
      new PurchasePoolPairLiquidityStrategy(
        mailService,
        settingService,
        assetService,
        liquidityOrderRepo,
        liquidityOrderFactory,
        this,
      ),
    );

    this.#purchaseLiquidityStrategies.set(
      AssetCategory.STOCK,
      new PurchaseStockLiquidityStrategy(mailService, liquidityService, liquidityOrderRepo, liquidityOrderFactory),
    );

    this.#purchaseLiquidityStrategies.set(
      AssetCategory.CRYPTO,
      new PurchaseCryptoLiquidityStrategy(mailService, liquidityService, liquidityOrderRepo, liquidityOrderFactory),
    );
  }

  // *** PUBLIC API *** //

  async checkLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    try {
      // calculating how much targetAmount is needed and if it's available on the node
      return this.liquidityService.getAvailableTargetLiquidity(
        referenceAsset,
        referenceAmount,
        targetAsset.dexName,
        LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      );
    } catch (e) {
      console.error(e);

      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) return 0;
      if (e instanceof PriceSlippageException) throw e;

      // default public exception
      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async reserveLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, referenceAsset, referenceAmount, targetAsset } = request;

    try {
      // calculating how much targetAmount is needed and if it's available on the node
      const liquidity = await this.liquidityService.getAvailableTargetLiquidity(
        referenceAsset,
        referenceAmount,
        targetAsset.dexName,
        LiquidityOrder.getMaxPriceSlippage(targetAsset.dexName),
      );

      if (liquidity !== 0) {
        const order = this.liquidityOrderFactory.createReservationOrder(request, 'defichain');
        order.reserved(liquidity);

        await this.liquidityOrderRepo.save(order);

        return order.targetAmount;
      }
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) throw e;
      if (e instanceof PriceSlippageException) throw e;

      // default public exception
      throw new Error(`Error while reserving liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
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

  async fetchTargetLiquidityAfterPurchase(context: LiquidityOrderContext, correlationId: string): Promise<number> {
    const order = await this.liquidityOrderRepo.findOne({ where: { context, correlationId } });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.targetAmount;
  }

  async completeOrders(context: LiquidityOrderContext, correlationId: string): Promise<void> {
    const incompleteOrders = await this.liquidityOrderRepo.find({
      where: { context, correlationId, isComplete: false, isReady: true },
    });

    if (incompleteOrders.length === 0) {
      throw new Error(`No ready liquidity orders found for context ${context} and correlationId: ${correlationId}`);
    }

    for (const order of incompleteOrders) {
      order.complete();
      await this.liquidityOrderRepo.save(order);
    }
  }

  @Interval(60000)
  async verifyPurchaseOrders(): Promise<void> {
    if (!this.verifyPurchaseOrdersLock.acquire()) return;

    const standingOrders = await this.liquidityOrderRepo.find({
      isReady: false,
      purchaseTxId: Not(IsNull()),
    });

    await this.addPurchasedAmountsToOrders(standingOrders);

    this.verifyPurchaseOrdersLock.release();
  }

  // *** HELPER METHODS *** //

  private async addPurchasedAmountsToOrders(orders: LiquidityOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const amount = await this.liquidityService.getPurchasedAmount(order.purchaseTxId, order.targetAsset.dexName);

        order.purchased(amount);
        await this.liquidityOrderRepo.save(order);
      } catch {
        continue;
      }
    }
  }
}
