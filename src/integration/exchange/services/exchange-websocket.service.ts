import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Exchange, Order, pro } from 'ccxt';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export interface OrderUpdateEvent {
  exchangeName: string;
  orderId: string;
  symbol: string;
  status: 'open' | 'closed' | 'canceled';
  filled: number;
  remaining: number;
  cost: number;
  amount: number;
  price: number;
}

type OrderCallback = (event: OrderUpdateEvent) => void;

interface WatchedOrder {
  orderId: string;
  symbol: string;
  callback: OrderCallback;
}

// Pro exchange type with WebSocket methods
type ProExchange = Exchange & {
  watchOrders(symbol?: string, since?: number, limit?: number, params?: Record<string, unknown>): Promise<Order[]>;
  close(): Promise<void>;
};

interface ExchangeConnection {
  exchange: ProExchange;
  watchedOrders: Map<string, WatchedOrder>;
  isWatching: boolean;
  watchPromise?: Promise<void>;
}

@Injectable()
export class ExchangeWebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new DfxLogger(ExchangeWebSocketService);

  private readonly connections = new Map<string, ExchangeConnection>();
  private isShuttingDown = false;

  onModuleInit(): void {
    this.initializeExchanges();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    await this.closeAllConnections();
  }

  /**
   * Watch an order for completion. Returns unsubscribe function.
   */
  watchOrder(exchangeName: string, orderId: string, symbol: string, callback: OrderCallback): () => void {
    const connection = this.connections.get(exchangeName);
    if (!connection) {
      this.logger.warn(`Exchange ${exchangeName} not supported for WebSocket watching`);
      return () => {};
    }

    const watchKey = `${orderId}:${symbol}`;

    // Add to watched orders
    connection.watchedOrders.set(watchKey, { orderId, symbol, callback });
    this.logger.verbose(`Started watching order ${orderId} on ${exchangeName}`);

    // Start watching if not already
    if (!connection.isWatching) {
      this.startWatching(exchangeName, connection);
    }

    // Return unsubscribe function
    return () => {
      connection.watchedOrders.delete(watchKey);
      this.logger.verbose(`Stopped watching order ${orderId} on ${exchangeName}`);

      // Stop watching if no more orders
      if (connection.watchedOrders.size === 0) {
        connection.isWatching = false;
      }
    };
  }

  /**
   * Check if an exchange supports WebSocket order watching.
   */
  supportsWebSocket(exchangeName: string): boolean {
    return this.connections.has(exchangeName);
  }

  // --- Private Methods --- //

  private initializeExchanges(): void {
    const config = GetConfig();

    // Initialize Kraken
    if (config.kraken?.apiKey) {
      this.initializeExchange('Kraken', pro.kraken as unknown as new (c: Record<string, unknown>) => ProExchange, config.kraken);
    }

    // Initialize Binance
    if (config.binance?.apiKey) {
      this.initializeExchange('Binance', pro.binance as unknown as new (c: Record<string, unknown>) => ProExchange, config.binance);
    }

    // Initialize MEXC
    if (config.mexc?.apiKey) {
      this.initializeExchange('MEXC', pro.mexc as unknown as new (c: Record<string, unknown>) => ProExchange, config.mexc);
    }

    // Initialize XT
    if (config.xt?.apiKey) {
      this.initializeExchange('XT', pro.xt as unknown as new (c: Record<string, unknown>) => ProExchange, config.xt);
    }

    this.logger.info(`Initialized WebSocket connections for: ${Array.from(this.connections.keys()).join(', ')}`);
  }

  private initializeExchange(
    name: string,
    ExchangeClass: new (config: Record<string, unknown>) => ProExchange,
    config: Record<string, unknown>,
  ): void {
    try {
      const exchange = new ExchangeClass({
        ...config,
        enableRateLimit: true,
        options: {
          ordersLimit: 100, // Cache limit for orders
        },
      });

      this.connections.set(name, {
        exchange,
        watchedOrders: new Map(),
        isWatching: false,
      });
    } catch (e) {
      this.logger.error(`Failed to initialize ${name} WebSocket:`, e);
    }
  }

  private startWatching(exchangeName: string, connection: ExchangeConnection): void {
    if (connection.isWatching) return;

    connection.isWatching = true;
    connection.watchPromise = this.watchOrdersLoop(exchangeName, connection);
  }

  private async watchOrdersLoop(exchangeName: string, connection: ExchangeConnection): Promise<void> {
    const { exchange } = connection;

    while (connection.isWatching && !this.isShuttingDown) {
      try {
        if (connection.watchedOrders.size === 0) {
          // No orders to watch, wait and check again
          await this.sleep(1000);
          continue;
        }

        // Watch all orders (no symbol filter) - CCXT Pro handles multiplexing
        // This is more efficient than iterating symbols sequentially
        const orders = await exchange.watchOrders();
        this.processOrderUpdates(exchangeName, connection, orders);
      } catch (e) {
        if (!this.isShuttingDown) {
          this.logger.error(`Error in watchOrdersLoop for ${exchangeName}:`, e);
          await this.sleep(5000); // Wait before retry
        }
      }
    }
  }

  private processOrderUpdates(exchangeName: string, connection: ExchangeConnection, orders: Order[]): void {
    for (const order of orders) {
      const watchKey = `${order.id}:${order.symbol}`;
      const watched = connection.watchedOrders.get(watchKey);

      if (watched) {
        const event: OrderUpdateEvent = {
          exchangeName,
          orderId: order.id,
          symbol: order.symbol,
          status: order.status as 'open' | 'closed' | 'canceled',
          filled: order.filled,
          remaining: order.remaining,
          cost: order.cost,
          amount: order.amount,
          price: order.price ?? order.average,
        };

        this.logger.verbose(`Order update for ${order.id} on ${exchangeName}: ${order.status}`);

        try {
          watched.callback(event);
        } catch (e) {
          this.logger.error(`Error in order callback for ${order.id}:`, e);
        }

        // Remove from watched if completed
        if (order.status === 'closed' || order.status === 'canceled') {
          connection.watchedOrders.delete(watchKey);
          this.logger.verbose(`Order ${order.id} completed, removed from watch list`);
        }
      }
    }
  }

  private async closeAllConnections(): Promise<void> {
    for (const [name, connection] of this.connections) {
      try {
        connection.isWatching = false;
        await connection.exchange.close();
        this.logger.verbose(`Closed WebSocket connection for ${name}`);
      } catch (e) {
        this.logger.error(`Error closing ${name} WebSocket:`, e);
      }
    }
    this.connections.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
