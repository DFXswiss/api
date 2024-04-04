import { Inject, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrderContext } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest, ReserveLiquidityRequest } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { MailRequest } from 'src/subdomains/supporting/notification/interfaces';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { TradingOrder } from '../entities/trading-order.entity';
import { TradingOrderStatus } from '../enums';
import { TradingOrderRepository } from '../repositories/trading-order.respository';
import { TradingRuleRepository } from '../repositories/trading-rule.respository';

@Injectable()
export class TradingOrderService {
  private readonly logger = new DfxLogger(TradingOrderService);

  @Inject() private readonly ruleRepo: TradingRuleRepository;
  @Inject() private readonly orderRepo: TradingOrderRepository;

  constructor(private readonly dexService: DexService, private readonly notificationService: NotificationService) {}

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
        this.logger.info(`Could not execute order ${order.id}: status is ${order.status}`);
        return;
      }

      order.inProgress();
      await this.orderRepo.save(order);

      await this.reserveLiquidity(order);
      await this.purchaseLiquidity(order);

      this.logger.verbose(`Trading order ${order.id} in progress`);
    } catch (e) {
      const message = `Failed to execute trading order ${order.id} (rule ${order.tradingRule.id}): ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
    }
  }

  private async reserveLiquidity(order: TradingOrder): Promise<void> {
    const reservationRequest: ReserveLiquidityRequest = {
      context: LiquidityOrderContext.TRADING,
      correlationId: this.correlationId(order, true),
      referenceAmount: order.amountIn,
      referenceAsset: order.assetIn,
      targetAsset: order.assetIn,
    };

    const reservedLiquidity = await this.dexService.reserveLiquidity(reservationRequest);

    if (reservedLiquidity < order.amountIn)
      throw new Error(`Liquidity not available: reserved ${reservedLiquidity}, needed ${order.amountIn}`);
  }

  private async closeReservation(order: TradingOrder): Promise<void> {
    await this.dexService.completeOrders(LiquidityOrderContext.TRADING, this.correlationId(order, true));
    await this.dexService.completeOrders(LiquidityOrderContext.TRADING, this.correlationId(order, false));
  }

  private async purchaseLiquidity(order: TradingOrder): Promise<void> {
    const purchaseRequest: PurchaseLiquidityRequest = {
      context: LiquidityOrderContext.TRADING,
      correlationId: this.correlationId(order, false),
      referenceAmount: order.amountIn,
      referenceAsset: order.assetIn,
      targetAsset: order.assetOut,
    };

    await this.dexService.purchaseLiquidity(purchaseRequest);
  }

  private async checkRunningOrders(): Promise<void> {
    const runningOrders = await this.orderRepo.findBy({ status: TradingOrderStatus.IN_PROGRESS });

    for (const order of runningOrders) {
      await this.checkOrder(order);
    }
  }

  private async checkOrder(order: TradingOrder): Promise<void> {
    try {
      const { isReady, purchaseTxId } = await this.dexService.checkOrderReady(
        LiquidityOrderContext.TRADING,
        this.correlationId(order, false),
      );

      if (isReady) await this.handleOrderCompletion(order, purchaseTxId);
    } catch (e) {
      const message = `Failed to check trading order ${order.id} (rule ${order.tradingRule.id}): ${e.message}`;
      await this.handleOrderFail(order, message);
      this.logger.error(message, e);
    }
  }

  private async handleOrderCompletion(order: TradingOrder, txId: string): Promise<void> {
    await this.closeReservation(order);

    order.complete(txId);
    await this.orderRepo.save(order);

    const rule = order.tradingRule.reactivate();
    await this.ruleRepo.save(rule);

    const message = `Trading order ${order.id} (rule ${order.tradingRule.id}) complete: swapped ${order.amountIn} ${order.assetIn.uniqueName} to ${order.assetOut.uniqueName}`;
    this.logger.verbose(message);

    // send mail
    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.DEX,
      input: {
        subject: 'Trading order SUCCESS',
        errors: [message],
        isLiqMail: true,
      },
    };

    await this.notificationService.sendMail(mailRequest);
  }

  private async handleOrderFail(order: TradingOrder, message: string): Promise<void> {
    await this.closeReservation(order);

    order.fail(message);
    await this.orderRepo.save(order);

    const rule = order.tradingRule.pause();
    await this.ruleRepo.save(rule);

    // send mail
    const mailRequest: MailRequest = {
      type: MailType.ERROR_MONITORING,
      context: MailContext.DEX,
      input: {
        subject: 'Trading order FAIL',
        errors: [message],
        isLiqMail: true,
      },
    };

    await this.notificationService.sendMail(mailRequest);
  }

  private correlationId(order: TradingOrder, isReservation: boolean): string {
    return `${order.id}${isReservation ? '-reservation' : ''}`;
  }
}
