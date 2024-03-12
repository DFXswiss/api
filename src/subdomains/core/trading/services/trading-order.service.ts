import { Inject, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingOrderStatus } from '../enums';
import { TradingOrderRepository } from '../repositories/trading-order.respository';
import { TradingRuleRepository } from '../repositories/trading-rule.respository';

@Injectable()
export class TradingOrderService {
  private readonly logger = new DfxLogger(TradingOrderService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly dexService: DexService) {}

  // --- PUBLIC API --- //

  async processOrders() {
    await this.startNewOrders();
    await this.checkRunningOrders();
  }

  // --- HELPER METHODS --- //

  private async startNewOrders(): Promise<void> {
    const orders = await this.orderRepo.findBy({ status: TradingOrderStatus.CREATED });

    for (const order of orders) {
      await this.executeOrder(order);
    }
  }

  private async executeOrder(order: TradingOrder): Promise<void> {
    try {
      if (!order.isCreated()) {
        const message = `Could not execute order ${order.id}: status is ${order.status}`;
        this.logger.info(message);
        return;
      }

      order.inProgress();
      await this.orderRepo.save(order);

      await this.reserveLiquidity(order);
      await this.purchaseLiquidity(order);

      this.logger.verbose(`Trading order ${order.id} in progress`);
    } catch (e) {
      const message = `Execute trading order ${order.id}: ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
    }
  }

  private async reserveLiquidity(order: TradingOrder): Promise<void> {
    const reservationRequest: ReserveLiquidityRequest = {
      context: LiquidityOrderContext.TRADING,
      correlationId: order.id.toString(),
      referenceAmount: order.amountIn,
      referenceAsset: order.assetIn,
      targetAsset: order.assetOut,
    };

    const reservedLiquidity = await this.dexService.reserveLiquidity(reservationRequest);

    if (reservedLiquidity < order.amountIn)
      throw new Error(`Liquidity not available: reserved ${reservedLiquidity}, needed ${order.amountIn}`);
  }

  private async closeReservation(order: TradingOrder): Promise<void> {
    return this.dexService.completeOrders(LiquidityOrderContext.TRADING, order.id.toString());
  }

  private async purchaseLiquidity(order: TradingOrder): Promise<void> {
    const purchaseRequest: PurchaseLiquidityRequest = {
      context: LiquidityOrderContext.TRADING,
      correlationId: order.id.toString(),
      referenceAmount: order.amountIn,
      referenceAsset: order.assetIn,
      targetAsset: order.assetOut,
    };

    await this.dexService.purchaseLiquidity(purchaseRequest);

    const { txId } = await this.dexService.fetchLiquidityTransactionResult(
      LiquidityOrderContext.TRADING,
      order.id.toString(),
    );

    order.txId = txId;
    await this.orderRepo.save(order);
  }

  private async checkRunningOrders(): Promise<void> {
    this.logger.verbose('Trading Order: checkRunningOrders()');

    const runningOrders = await this.orderRepo.findBy({ status: TradingOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      await this.checkOrder(order);
    }
  }

  private async checkOrder(order: TradingOrder): Promise<void> {
    try {
      const { isComplete } = await this.dexService.checkOrderCompletion(
        LiquidityOrderContext.TRADING,
        order.id.toString(),
      );

      if (isComplete) {
        await this.closeReservation(order);

        order.complete();
        await this.orderRepo.save(order);

        const rule = order.tradingRule.reactivate();
        await this.ruleRepo.save(rule);

        this.logger.verbose(`Trading order ${order.id} complete`);
      }
    } catch (e) {
      const message = `Check trading order ${order.id}: ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
    }
  }

  private async handleOrderFail(order: TradingOrder, message: string): Promise<void> {
    await this.closeReservation(order);

    order.fail(message);
    await this.orderRepo.save(order);

    const rule = order.tradingRule.pause();
    await this.ruleRepo.save(rule);
  }
}
