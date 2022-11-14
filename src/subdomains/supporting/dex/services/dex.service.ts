import { Injectable } from '@nestjs/common';
import { LiquidityOrder, LiquidityOrderContext } from '../entities/liquidity-order.entity';
import { DexDeFiChainService } from './dex-defichain.service';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { Interval } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { Not, IsNull } from 'typeorm';
import { LiquidityOrderFactory } from '../factories/liquidity-order.factory';
import { CheckLiquidityStrategies } from '../strategies/check-liquidity/check-liquidity.facade';
import { LiquidityRequest, CheckLiquidityResult, TransferRequest, PurchaseLiquidityResult } from '../interfaces';
import { PurchaseLiquidityStrategies } from '../strategies/purchase-liquidity/purchase-liquidity.facade';

@Injectable()
export class DexService {
  private readonly verifyPurchaseOrdersLock = new Lock(1800);

  constructor(
    private readonly checkStrategies: CheckLiquidityStrategies,
    private readonly purchaseStrategies: PurchaseLiquidityStrategies,
    private readonly dexDeFiChainService: DexDeFiChainService,
    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {}

  // *** MAIN PUBLIC API *** //

  async checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult> {
    const { context, correlationId, targetAsset } = request;

    try {
      const strategy = this.checkStrategies.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(
          `No check liquidity strategy for asset ${targetAsset.dexName} ${targetAsset.type} ${targetAsset.blockchain}`,
        );
      }

      return strategy.checkLiquidity(request);
    } catch (e) {
      console.error(e.message);

      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async reserveLiquidity(request: LiquidityRequest): Promise<number> {
    const { context, correlationId, targetAsset } = request;

    try {
      console.info(`Reserving ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`);

      const strategy = this.checkStrategies.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(
          `No check liquidity strategy for asset ${targetAsset.dexName} ${targetAsset.type} ${targetAsset.blockchain}`,
        );
      }

      const liquidity = await strategy.checkLiquidity(request);

      this.handleCheckLiquidityResult(liquidity);

      const order = this.liquidityOrderFactory.createReservationOrder(request, targetAsset.blockchain);
      order.reserved(liquidity.target.amount);

      await this.liquidityOrderRepo.save(order);

      return order.targetAmount;
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) throw e;
      if (e instanceof PriceSlippageException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while reserving liquidity. Context: ${context}. Correlation ID: ${correlationId}.`);
    }
  }

  async purchaseLiquidity(request: LiquidityRequest): Promise<void> {
    const { context, correlationId, targetAsset } = request;
    const strategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(targetAsset);

    if (!strategy) {
      throw new Error(
        `No purchase liquidity strategy for asset ${targetAsset.dexName} ${targetAsset.type} ${targetAsset.blockchain}`,
      );
    }

    try {
      console.info(
        `Purchasing ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;
      if (e instanceof NotEnoughLiquidityException) throw e;

      console.error(e.message);

      // default public exception
      throw new Error(`Error while purchasing liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async fetchLiquidityAfterPurchase(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<PurchaseLiquidityResult> {
    const order = await this.liquidityOrderRepo.findOne({ where: { context, correlationId } });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.getPurchaseLiquidityResult();
  }

  async checkOrderReady(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isReady: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOne({ context, correlationId });

    const purchaseTxId = order && order.purchaseTxId;
    const isReady = order && order.isReady;

    return { isReady, purchaseTxId };
  }

  async checkOrderCompletion(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isComplete: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOne({ context, correlationId });

    const purchaseTxId = order && order.purchaseTxId;
    const isComplete = order && order.isComplete;

    return { isComplete, purchaseTxId };
  }

  async completeOrders(context: LiquidityOrderContext, correlationId: string): Promise<void> {
    const incompleteOrders = await this.liquidityOrderRepo.find({
      where: { context, correlationId, isComplete: false, isReady: true },
    });

    for (const order of incompleteOrders) {
      order.complete();
      await this.liquidityOrderRepo.save(order);
    }
  }

  // *** SUPPLEMENTARY PUBLIC API *** //

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return this.dexDeFiChainService.transferLiquidity(destinationAddress, asset.dexName, amount);
  }

  async transferMinimalUtxo(address: string): Promise<string> {
    return this.dexDeFiChainService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexDeFiChainService.checkTransferCompletion(transferTxId);
  }

  //*** JOBS ***//

  @Interval(30000)
  async finalizePurchaseOrders(): Promise<void> {
    if (!this.verifyPurchaseOrdersLock.acquire()) return;

    try {
      const standingOrders = await this.liquidityOrderRepo.find({
        isReady: false,
        purchaseTxId: Not(IsNull()),
      });

      await this.addPurchaseDataToOrders(standingOrders);
    } finally {
      this.verifyPurchaseOrdersLock.release();
    }
  }

  // *** HELPER METHODS *** //

  private handleCheckLiquidityResult(liquidity: CheckLiquidityResult): void {
    const { metadata, target } = liquidity;
    if (!metadata.isEnoughAvailableLiquidity) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${target.asset.dexName}. Available amount: ${target.availableAmount}.`,
      );
    }

    if (metadata.isSlippageDetected) {
      throw new PriceSlippageException(metadata.slippageMessage);
    }
  }

  private async addPurchaseDataToOrders(orders: LiquidityOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const strategy = this.purchaseStrategies.getPurchaseLiquidityStrategy(order.targetAsset);

        if (!strategy) {
          const { dexName, blockchain, type } = order.targetAsset;
          throw new Error(`No purchase liquidity strategy for asset ${dexName} ${blockchain} ${type}`);
        }

        await strategy.addPurchaseData(order);

        console.info(
          `Liquidity purchase is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
        );
      } catch {
        continue;
      }
    }
  }
}
