import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { FeeAmount } from '@uniswap/v3-sdk';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLoggerService, LogLevel } from 'src/shared/services/dfx-logger.service';
import { DfxCron } from 'src/shared/utils/cron';
import { IsNull, Not } from 'typeorm';
import { LiquidityOrder, LiquidityOrderContext, LiquidityOrderType } from '../entities/liquidity-order.entity';
import { LiquidityOrderNotReadyException } from '../exceptions/liquidity-order-not-ready.exception';
import { NotEnoughLiquidityException } from '../exceptions/not-enough-liquidity.exception';
import { PriceSlippageException } from '../exceptions/price-slippage.exception';
import { TransactionNotFoundException } from '../exceptions/transaction-not-found.exception';
import { LiquidityOrderFactory } from '../factories/liquidity-order.factory';
import {
  CheckLiquidityRequest,
  CheckLiquidityResult,
  LiquidityTransactionResult,
  PurchaseLiquidityRequest,
  ReserveLiquidityRequest,
  SellLiquidityRequest,
  TransactionQuery,
  TransactionResult,
  TransferRequest,
} from '../interfaces';
import { LiquidityOrderRepository } from '../repositories/liquidity-order.repository';
import { CheckLiquidityStrategyRegistry } from '../strategies/check-liquidity/impl/base/check-liquidity.strategy-registry';
import { PurchaseLiquidityStrategyRegistry } from '../strategies/purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { SellLiquidityStrategyRegistry } from '../strategies/sell-liquidity/impl/base/sell-liquidity.strategy-registry';
import { SupplementaryStrategyRegistry } from '../strategies/supplementary/impl/base/supplementary.strategy-registry';

@Injectable()
export class DexService {
  constructor(
    private readonly logger: DfxLoggerService,
    private readonly checkLiquidityStrategyRegistry: CheckLiquidityStrategyRegistry,
    private readonly purchaseLiquidityStrategyRegistry: PurchaseLiquidityStrategyRegistry,
    private readonly sellLiquidityStrategyRegistry: SellLiquidityStrategyRegistry,
    private readonly supplementaryStrategyRegistry: SupplementaryStrategyRegistry,

    private readonly liquidityOrderRepo: LiquidityOrderRepository,
    private readonly liquidityOrderFactory: LiquidityOrderFactory,
  ) {
    this.logger.create(DexService);
  }

  // *** MAIN PUBLIC API *** //

  async checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult> {
    const { context, correlationId, targetAsset } = request;

    try {
      const strategy = this.checkLiquidityStrategyRegistry.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(`No check liquidity strategy for asset ${targetAsset.uniqueName}`);
      }

      return await strategy.checkLiquidity(request);
    } catch (e) {
      this.logger.error('Error while checking liquidity:', e);

      throw new Error(`Error while checking liquidity. Context: ${context}. Correlation ID: ${correlationId}`);
    }
  }

  async reserveLiquidity(request: ReserveLiquidityRequest): Promise<number> {
    const { context, correlationId, targetAsset } = request;

    try {
      this.logger.verbose(
        `Reserving ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );

      const strategy = this.checkLiquidityStrategyRegistry.getCheckLiquidityStrategy(targetAsset);

      if (!strategy) {
        throw new Error(`No check liquidity strategy for asset ${targetAsset.uniqueName}`);
      }

      const liquidity = await strategy.checkLiquidity(request);

      this.handleCheckLiquidityResult(liquidity);

      const order = this.liquidityOrderFactory.createReservationOrder(request, targetAsset.blockchain);
      order.reserved(liquidity.target.amount);
      order.addEstimatedTargetAmount(liquidity.target.amount);

      await this.liquidityOrderRepo.save(order);

      return order.targetAmount;
    } catch (e) {
      // publicly exposed exceptions
      if (e instanceof NotEnoughLiquidityException) throw e;
      if (e instanceof PriceSlippageException) throw e;

      this.logger.error('Error while reserving liquidity:', e);

      // default public exception
      throw new Error(`Error while reserving liquidity. Context: ${context}. Correlation ID: ${correlationId}.`);
    }
  }

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const { context, correlationId, targetAsset } = request;
    const strategy = this.purchaseLiquidityStrategyRegistry.getPurchaseLiquidityStrategy(targetAsset);

    if (!strategy) {
      throw new Error(`No purchase liquidity strategy for asset ${targetAsset.uniqueName}`);
    }

    try {
      this.logger.verbose(
        `Purchasing ${targetAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );
      await strategy.purchaseLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;
      if (e instanceof NotEnoughLiquidityException) throw e;

      this.logger.error('Error while purchasing liquidity:', e);

      // default public exception
      throw new Error(`Error while purchasing liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async sellLiquidity(request: SellLiquidityRequest): Promise<void> {
    const { context, correlationId, sellAsset } = request;
    const strategy = this.sellLiquidityStrategyRegistry.getSellLiquidityStrategy(sellAsset);

    if (!strategy) {
      throw new Error(`No sell liquidity strategy for asset ${sellAsset.uniqueName}`);
    }

    try {
      this.logger.verbose(
        `Selling ${sellAsset.dexName} liquidity. Context: ${context}. Correlation ID: ${correlationId}`,
      );
      await strategy.sellLiquidity(request);
    } catch (e) {
      // publicly exposed exception
      if (e instanceof PriceSlippageException) throw e;
      if (e instanceof NotEnoughLiquidityException) throw e;

      this.logger.error('Error while selling liquidity:', e);

      // default public exception
      throw new Error(`Error while selling liquidity. Context: ${context}. Correlation ID: ${correlationId}. `);
    }
  }

  async fetchLiquidityTransactionResult(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<LiquidityTransactionResult> {
    const order = await this.liquidityOrderRepo.findOneBy({ context, correlationId });

    if (!order) {
      throw new Error(`Order not found. Context: ${context}. Correlation ID: ${correlationId}.`);
    }

    if (!order.targetAmount) {
      throw new LiquidityOrderNotReadyException(`Order is not ready. Order ID: ${order.id}`);
    }

    return order.getLiquidityTransactionResult();
  }

  async checkOrderReady(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isReady: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOneBy({ context, correlationId });

    const purchaseTxId = order && order.txId;
    const isReady = order && order.isReady;

    return { isReady, purchaseTxId };
  }

  async checkOrderCompletion(
    context: LiquidityOrderContext,
    correlationId: string,
  ): Promise<{ isComplete: boolean; purchaseTxId: string }> {
    const order = await this.liquidityOrderRepo.findOneBy({ context, correlationId });

    const purchaseTxId = order && order.txId;
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

  async cancelOrders(context: LiquidityOrderContext, correlationId: string): Promise<void> {
    const orders = await this.liquidityOrderRepo.find({
      where: { context, correlationId },
    });

    for (const order of orders) {
      order.cancel();
      await this.liquidityOrderRepo.save(order);
    }
  }

  async hasOrder(context: LiquidityOrderContext, correlationId: string): Promise<boolean> {
    return this.liquidityOrderRepo
      .findOne({ where: { context, correlationId }, loadEagerRelations: false })
      .then((o) => o != null);
  }

  async getPendingOrders(context: LiquidityOrderContext): Promise<string[]> {
    const pending = await this.liquidityOrderRepo.find({ where: { context }, select: ['context', 'correlationId'] });
    return pending.map((o) => o.correlationId);
  }

  async getPendingOrdersCount(asset: Asset): Promise<number> {
    return this.liquidityOrderRepo.countBy([
      { targetAsset: { id: asset.id }, isComplete: false },
      { targetAsset: { id: asset.id }, isReady: false },
      { swapAsset: { id: asset.id }, isComplete: false },
      { swapAsset: { id: asset.id }, isReady: false },
    ]);
  }

  // *** SUPPLEMENTARY PUBLIC API *** //

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { asset, amount } = request;
    const strategy = this.supplementaryStrategyRegistry.getSupplementaryStrategyByAsset(asset);

    if (!strategy) {
      throw new Error(`No supplementary strategy found for asset ${asset.uniqueName} during #transferLiquidity(...)`);
    }

    this.logger.verbose(`Transferring ${amount} ${asset.uniqueName} liquidity.`);
    return strategy.transferLiquidity(request);
  }

  async checkTransferCompletion(transferTxId: string, blockchain: Blockchain): Promise<boolean> {
    const strategy = this.supplementaryStrategyRegistry.getSupplementaryStrategyByBlockchain(blockchain);

    if (!strategy) {
      throw new Error(
        `No supplementary strategy found for blockchain ${blockchain} during #checkTransferCompletion(...)`,
      );
    }

    try {
      return await strategy.checkTransferCompletion(transferTxId);
    } catch (e) {
      this.logger.error('Error while checking transfer completion:', e);

      // default public exception
      throw new Error(`Error while checking transfer completion for transferTxId: ${transferTxId}.`);
    }
  }

  async findTransaction(query: TransactionQuery): Promise<TransactionResult> {
    const { asset, amount, since } = query;
    const strategy = this.supplementaryStrategyRegistry.getSupplementaryStrategyByAsset(asset);

    if (!strategy) {
      throw new Error(`No supplementary strategy found for asset ${asset.uniqueName} during #findTransaction(...)`);
    }

    try {
      return await strategy.findTransaction(query);
    } catch (e) {
      this.logger.error('Error while finding transaction:', e);

      // default public exception
      throw new Error(`Error while searching ${amount} ${asset.uniqueName} transaction since ${since.toDateString()}.`);
    }
  }

  async calculatePrice(from: Asset, to: Asset, poolFee?: FeeAmount): Promise<number> {
    if (from.blockchain !== to.blockchain) throw new Error('Swapping between chains is not possible');

    const strategy = this.supplementaryStrategyRegistry.getSupplementaryStrategyByAsset(from);

    if (!strategy) {
      throw new Error(`No supplementary strategy found for asset ${from.uniqueName} during #calculatePrice(...)`);
    }
    try {
      return await strategy.calculatePrice(from, to, poolFee);
    } catch (e) {
      this.logger.error('Error while getting target amount:', e);

      // default public exception
      throw new Error(`Error while getting price from ${from.uniqueName} to ${to.uniqueName}.`);
    }
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_30_SECONDS, { timeout: 1800 })
  async finalizePurchaseOrders(): Promise<void> {
    const standingOrders = await this.liquidityOrderRepo.findBy({
      isReady: false,
      txId: Not(IsNull()),
    });

    await this.addPurchaseDataToOrders(standingOrders);
  }

  // *** HELPER METHODS *** //

  private handleCheckLiquidityResult(liquidity: CheckLiquidityResult): void {
    const { metadata, target } = liquidity;
    if (!metadata.isEnoughAvailableLiquidity) {
      throw new NotEnoughLiquidityException(
        `Not enough liquidity of asset ${target.asset.dexName} (requested: ${target.amount}, available: ${target.availableAmount})`,
      );
    }

    if (metadata.isSlippageDetected) {
      throw new PriceSlippageException(metadata.slippageMessage);
    }
  }

  private async addPurchaseDataToOrders(orders: LiquidityOrder[]): Promise<void> {
    for (const order of orders) {
      switch (order.type) {
        case LiquidityOrderType.PURCHASE:
          await this.addPurchaseDataToOrder(order);
          break;

        case LiquidityOrderType.SELL:
          await this.addSellDataToOrder(order);
          break;

        default:
          continue;
      }
    }
  }

  private async addPurchaseDataToOrder(order: LiquidityOrder): Promise<void> {
    try {
      const strategy = this.purchaseLiquidityStrategyRegistry.getPurchaseLiquidityStrategy(order.targetAsset);

      if (!strategy) {
        throw new Error(`No purchase liquidity strategy for asset ${order.targetAsset.uniqueName}`);
      }

      await strategy.addPurchaseData(order);

      this.logger.verbose(
        `Liquidity purchase is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
      );
    } catch (e) {
      const logLevel = e instanceof TransactionNotFoundException ? LogLevel.INFO : LogLevel.ERROR;
      this.logger.log(logLevel, `Error while trying to add purchase data to liquidity order ${order.id}:`, e);
    }
  }

  private async addSellDataToOrder(order: LiquidityOrder): Promise<void> {
    try {
      const strategy = this.sellLiquidityStrategyRegistry.getSellLiquidityStrategy(order.targetAsset);

      if (!strategy) {
        throw new Error(`No sell liquidity strategy for asset ${order.targetAsset.uniqueName}`);
      }

      await strategy.addSellData(order);

      this.logger.verbose(
        `Liquidity sell is ready. Order ID: ${order.id}. Context: ${order.context}. Correlation ID: ${order.correlationId}`,
      );
    } catch (e) {
      const logLevel = e instanceof TransactionNotFoundException ? LogLevel.INFO : LogLevel.ERROR;
      this.logger.log(logLevel, `Error while trying to add sell data to liquidity order ${order.id}:`, e);
    }
  }
}
