import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Observable, Subject } from 'rxjs';
import {
  ExchangeWebSocketService,
  OrderUpdateEvent,
} from 'src/integration/exchange/services/exchange-websocket.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementOrderStatus, LiquidityManagementSystem } from '../enums';
import { OrderFailedException } from '../exceptions/order-failed.exception';
import { OrderNotProcessableException } from '../exceptions/order-not-processable.exception';
import { LiquidityActionIntegrationFactory } from '../factories/liquidity-action-integration.factory';
import { LiquidityManagementOrderRepository } from '../repositories/liquidity-management-order.repository';

export interface OrderCompletionEvent {
  orderId: number;
  pipelineId: number;
  status: LiquidityManagementOrderStatus;
}

// Systems that support WebSocket for trade order updates
const WEBSOCKET_SUPPORTED_SYSTEMS = [
  LiquidityManagementSystem.KRAKEN,
  LiquidityManagementSystem.BINANCE,
  LiquidityManagementSystem.MEXC,
  LiquidityManagementSystem.XT,
];

// Commands that are trade orders (not withdrawals/transfers)
const TRADE_COMMANDS = ['buy', 'sell'];

@Injectable()
export class OrderCompletionService implements OnModuleDestroy {
  private readonly logger = new DfxLogger(OrderCompletionService);

  // Central event stream for order completions
  private readonly orderCompletedSubject = new Subject<OrderCompletionEvent>();

  // Active polling intervals for orders
  private readonly activePollingIntervals = new Map<number, NodeJS.Timeout>();

  // WebSocket unsubscribe functions for orders
  private readonly activeWebSocketSubscriptions = new Map<number, () => void>();

  // Polling interval in milliseconds (increased since WebSocket is primary for trades)
  private readonly POLLING_INTERVAL_MS = 5000;

  constructor(
    private readonly orderRepo: LiquidityManagementOrderRepository,
    private readonly actionIntegrationFactory: LiquidityActionIntegrationFactory,
    private readonly exchangeWebSocketService: ExchangeWebSocketService,
  ) {}

  // Observable for subscribers to react to order completions
  get orderCompleted$(): Observable<OrderCompletionEvent> {
    return this.orderCompletedSubject.asObservable();
  }

  // Cleanup on module destruction
  onModuleDestroy(): void {
    this.stopAllPolling();
    this.stopAllWebSocketSubscriptions();
    this.orderCompletedSubject.complete();
  }

  /**
   * Fallback cron - reduced frequency since active polling is primary.
   * Checks all IN_PROGRESS orders every 5 minutes as a safety net.
   */
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.LIQUIDITY_MANAGEMENT, timeout: 300 })
  async checkRunningOrdersFallback(): Promise<void> {
    const runningOrders = await this.orderRepo.findBy({
      status: LiquidityManagementOrderStatus.IN_PROGRESS,
    });

    this.logger.verbose(`Fallback check: ${runningOrders.length} orders in progress`);

    for (const order of runningOrders) {
      await this.checkAndEmitOrderCompletion(order);
    }
  }

  /**
   * Starts active monitoring for a specific order.
   * Uses WebSocket for supported exchanges (Kraken, Binance, MEXC, XT) with polling as fallback.
   * For non-WebSocket orders (withdrawals, transfers), uses polling only.
   */
  async startActivePolling(orderId: number): Promise<void> {
    if (this.activePollingIntervals.has(orderId)) {
      return; // Already monitoring
    }

    // Load order to check if WebSocket is applicable
    const order = await this.orderRepo.findOneBy({ id: orderId });
    if (!order) {
      this.logger.warn(`Order ${orderId} not found, skipping active monitoring`);
      return;
    }

    // Try to start WebSocket subscription for trade orders on supported exchanges
    const useWebSocket = this.tryStartWebSocketSubscription(order);

    if (useWebSocket) {
      this.logger.verbose(`Started WebSocket monitoring for order ${orderId} (with polling fallback)`);
    } else {
      this.logger.verbose(`Started polling-only monitoring for order ${orderId}`);
    }

    // Always start polling as fallback (or primary for non-WebSocket orders)
    const interval = setInterval(async () => {
      try {
        const currentOrder = await this.orderRepo.findOneBy({ id: orderId });

        if (!currentOrder || currentOrder.status !== LiquidityManagementOrderStatus.IN_PROGRESS) {
          // Order not found or already in terminal state
          this.stopActiveMonitoring(orderId);
          return;
        }

        const completed = await this.checkAndEmitOrderCompletion(currentOrder);
        if (completed) {
          this.stopActiveMonitoring(orderId);
        }
      } catch (e) {
        this.logger.error(`Error in active polling for order ${orderId}:`, e);
      }
    }, this.POLLING_INTERVAL_MS);

    this.activePollingIntervals.set(orderId, interval);
  }

  /**
   * Tries to start a WebSocket subscription for trade orders.
   * @returns true if WebSocket subscription was started
   */
  private tryStartWebSocketSubscription(order: LiquidityManagementOrder): boolean {
    const { action, correlationId, inputAsset, outputAsset } = order;

    // Only trade orders (buy/sell) can use WebSocket
    if (!TRADE_COMMANDS.includes(action.command)) {
      return false;
    }

    // Check if exchange supports WebSocket
    if (!WEBSOCKET_SUPPORTED_SYSTEMS.includes(action.system as LiquidityManagementSystem)) {
      return false;
    }

    // Need correlation ID (exchange order ID) and trading pair
    if (!correlationId || !inputAsset || !outputAsset) {
      this.logger.verbose(`Order ${order.id} missing data for WebSocket: correlationId=${correlationId}, pair=${inputAsset}/${outputAsset}`);
      return false;
    }

    // Build trading pair symbol (e.g., "BTC/USDT")
    // For BUY: inputAsset=quote (USDT), outputAsset=base (BTC) → BTC/USDT
    // For SELL: inputAsset=base (BTC), outputAsset=quote (USDT) → BTC/USDT
    const symbol = action.command === 'buy'
      ? `${outputAsset}/${inputAsset}`
      : `${inputAsset}/${outputAsset}`;

    try {
      const unsubscribe = this.exchangeWebSocketService.watchOrder(
        action.system,
        correlationId,
        symbol,
        (event) => this.handleWebSocketOrderUpdate(order.id, event),
      );

      this.activeWebSocketSubscriptions.set(order.id, unsubscribe);
      return true;
    } catch (e) {
      this.logger.error(`Failed to start WebSocket for order ${order.id}:`, e);
      return false;
    }
  }

  /**
   * Handles WebSocket order update events.
   */
  private async handleWebSocketOrderUpdate(orderId: number, event: OrderUpdateEvent): Promise<void> {
    try {
      if (event.status !== 'closed' && event.status !== 'canceled') {
        return; // Order still open
      }

      this.logger.verbose(`WebSocket: Order ${orderId} completed with status ${event.status}`);

      // Load fresh order from database
      const order = await this.orderRepo.findOneBy({ id: orderId });
      if (!order || order.status !== LiquidityManagementOrderStatus.IN_PROGRESS) {
        // Already processed (by polling or another event)
        this.stopActiveMonitoring(orderId);
        return;
      }

      // Update order with trade data from WebSocket
      // For BUY: inputAmount = cost (quote spent), outputAmount = filled (base received)
      // For SELL: inputAmount = filled (base sold), outputAmount = cost (quote received)
      const isBuyOrder = order.action.command === 'buy';
      order.inputAmount = isBuyOrder ? event.cost : event.filled;
      order.outputAmount = isBuyOrder ? event.filled : event.cost;

      if (event.status === 'closed') {
        order.complete();
        await this.orderRepo.save(order);
        this.emitOrderCompletion(order, LiquidityManagementOrderStatus.COMPLETE);
      } else {
        // canceled - need to check if it's a failure or partial fill
        order.fail(new OrderFailedException(`Order was canceled on exchange`));
        await this.orderRepo.save(order);
        this.emitOrderCompletion(order, LiquidityManagementOrderStatus.FAILED);
      }

      this.stopActiveMonitoring(orderId);
    } catch (e) {
      this.logger.error(`Error handling WebSocket update for order ${orderId}:`, e);
    }
  }

  /**
   * Stops all active monitoring (polling + WebSocket) for a specific order.
   */
  stopActiveMonitoring(orderId: number): void {
    // Stop polling
    const interval = this.activePollingIntervals.get(orderId);
    if (interval) {
      clearInterval(interval);
      this.activePollingIntervals.delete(orderId);
    }

    // Stop WebSocket subscription
    const unsubscribe = this.activeWebSocketSubscriptions.get(orderId);
    if (unsubscribe) {
      unsubscribe();
      this.activeWebSocketSubscriptions.delete(orderId);
    }

    this.logger.verbose(`Stopped active monitoring for order ${orderId}`);
  }

  /**
   * @deprecated Use stopActiveMonitoring instead
   */
  stopActivePolling(orderId: number): void {
    this.stopActiveMonitoring(orderId);
  }

  /**
   * Stops all active polling (used on module destroy).
   */
  private stopAllPolling(): void {
    for (const [orderId, interval] of this.activePollingIntervals) {
      clearInterval(interval);
      this.logger.verbose(`Stopped active polling for order ${orderId} (cleanup)`);
    }
    this.activePollingIntervals.clear();
  }

  /**
   * Stops all WebSocket subscriptions (used on module destroy).
   */
  private stopAllWebSocketSubscriptions(): void {
    for (const [orderId, unsubscribe] of this.activeWebSocketSubscriptions) {
      unsubscribe();
      this.logger.verbose(`Stopped WebSocket subscription for order ${orderId} (cleanup)`);
    }
    this.activeWebSocketSubscriptions.clear();
  }

  /**
   * Checks if an order is complete and emits an event if so.
   * @returns true if order is complete, false otherwise
   */
  private async checkAndEmitOrderCompletion(order: LiquidityManagementOrder): Promise<boolean> {
    try {
      const actionIntegration = this.actionIntegrationFactory.getIntegration(order.action);
      const isComplete = await actionIntegration.checkCompletion(order);

      if (isComplete) {
        order.complete();
        await this.orderRepo.save(order);

        this.logger.verbose(`Order ${order.id} completed, emitting event`);
        this.emitOrderCompletion(order, LiquidityManagementOrderStatus.COMPLETE);
        return true;
      }
    } catch (e) {
      if (e instanceof OrderNotProcessableException) {
        order.notProcessable(e);
        await this.orderRepo.save(order);
        this.emitOrderCompletion(order, LiquidityManagementOrderStatus.NOT_PROCESSABLE);
        return true;
      } else if (e instanceof OrderFailedException) {
        order.fail(e);
        await this.orderRepo.save(order);
        this.emitOrderCompletion(order, LiquidityManagementOrderStatus.FAILED);
        return true;
      } else {
        this.logger.error(`Error checking order ${order.id}:`, e);
      }
    }

    return false;
  }

  /**
   * Emits an order completion event to all subscribers.
   * Public method for use by PipelineService when orders complete immediately during execution.
   */
  emitOrderCompletion(order: LiquidityManagementOrder, status: LiquidityManagementOrderStatus): void {
    this.orderCompletedSubject.next({
      orderId: order.id,
      pipelineId: order.pipeline.id,
      status,
    });
  }
}
