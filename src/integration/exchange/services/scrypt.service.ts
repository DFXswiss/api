import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncSubscription } from 'src/shared/utils/async-field';
import { Util } from 'src/shared/utils/util';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingProvider } from 'src/subdomains/supporting/pricing/services/integration/pricing-provider';
import {
  ScryptBalance,
  ScryptBalanceTransaction,
  ScryptExecutionReport,
  ScryptMarketDataSnapshot,
  ScryptOrderBook,
  ScryptOrderInfo,
  ScryptOrderResponse,
  ScryptOrderSide,
  ScryptOrderStatus,
  ScryptOrderType,
  ScryptSecurity,
  ScryptTimeInForce,
  ScryptTrade,
  ScryptTransactionStatus,
  ScryptTransactionType,
  ScryptWithdrawResponse,
  ScryptWithdrawStatus,
} from '../dto/scrypt.dto';
import { TradeChangedException } from '../exceptions/trade-changed.exception';
import { ScryptMessageType, ScryptWebSocketConnection } from './scrypt-websocket-connection';

@Injectable()
export class ScryptService extends PricingProvider {
  private readonly logger = new DfxLogger(ScryptService);
  private readonly connection: ScryptWebSocketConnection;

  // Subscriptions
  private readonly securities: AsyncSubscription<ScryptSecurity[]>;
  private readonly balances: AsyncSubscription<Map<string, ScryptBalance>>;
  private readonly executionReports: Map<string, ScryptExecutionReport> = new Map();

  readonly name: string = 'Scrypt';

  constructor() {
    super();

    const config = GetConfig().scrypt;
    this.connection = new ScryptWebSocketConnection(config.wsUrl, config.apiKey, config.apiSecret);

    // Securities subscription
    this.securities = new AsyncSubscription((cb) => {
      this.connection.subscribeToStream<ScryptSecurity>(ScryptMessageType.SECURITY, cb);
    });

    // Balances subscription (accumulate into Map)
    this.balances = new AsyncSubscription((cb) => {
      const map = new Map<string, ScryptBalance>();
      this.connection.subscribeToStream<ScryptBalance>(ScryptMessageType.BALANCE, (balances) => {
        for (const b of balances) map.set(b.Currency, b);
        cb(map);
      });
    });

    // ExecutionReport subscription (accumulate into Map, no await needed)
    this.connection.subscribeToStream<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT, (reports) => {
      for (const report of reports) {
        this.executionReports.set(report.ClOrdID, report);
      }
    });
  }

  // --- BALANCES --- //

  async getTotalBalances(): Promise<Record<string, number>> {
    const balances = await this.balances;

    const totalBalances: Record<string, number> = {};
    for (const balance of balances.values()) {
      totalBalances[balance.Currency] = parseFloat(balance.Amount) || 0;
    }

    return totalBalances;
  }

  async getAvailableBalance(currency: string): Promise<number> {
    const balances = await this.balances;

    const balance = balances.get(currency);
    return balance ? parseFloat(balance.AvailableAmount) || 0 : 0;
  }

  // --- WITHDRAWALS --- //

  async withdrawFunds(
    currency: string,
    amount: number,
    address: string,
    memo?: string,
  ): Promise<ScryptWithdrawResponse> {
    const clReqId = randomUUID();

    const withdrawRequest = {
      type: ScryptMessageType.NEW_WITHDRAW_REQUEST,
      data: [
        {
          Quantity: amount.toString(),
          Currency: currency,
          MarketAccount: 'default',
          RoutingInfo: {
            WalletAddress: address,
            Memo: memo ?? '',
            DestinationTag: '',
          },
          ClReqID: clReqId,
        },
      ],
    };

    const transaction = await this.connection.requestAndWaitForUpdate<ScryptBalanceTransaction>(
      withdrawRequest,
      ScryptMessageType.BALANCE_TRANSACTION,
      (transactions) =>
        transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === ScryptTransactionType.WITHDRAWAL) ??
        null,
      60000,
    );

    if (transaction.Status === ScryptTransactionStatus.REJECTED) {
      throw new Error(
        `Scrypt withdrawal rejected: ${transaction.RejectText ?? transaction.RejectReason ?? 'Unknown reason'}`,
      );
    }

    return {
      id: clReqId,
      status: transaction.Status,
    };
  }

  async getWithdrawalStatus(clReqId: string): Promise<ScryptWithdrawStatus | null> {
    const transactions = await this.fetchBalanceTransactions();
    const transaction = transactions.find(
      (t) => t.ClReqID === clReqId && t.TransactionType === ScryptTransactionType.WITHDRAWAL,
    );

    if (!transaction) return null;

    return {
      id: transaction.TransactionID,
      status: transaction.Status,
      txHash: transaction.TxHash,
      amount: parseFloat(transaction.Quantity) || undefined,
      rejectReason: transaction.RejectReason,
      rejectText: transaction.RejectText,
    };
  }

  // --- TRANSACTIONS --- //

  async getAllTransactions(since?: Date): Promise<ScryptBalanceTransaction[]> {
    const transactions = await this.fetchBalanceTransactions();
    return transactions.filter((t) => !since || (t.TransactTime && new Date(t.TransactTime) >= since));
  }

  private async fetchBalanceTransactions(): Promise<ScryptBalanceTransaction[]> {
    return this.connection.fetch<ScryptBalanceTransaction>(ScryptMessageType.BALANCE_TRANSACTION);
  }

  async getTrades(since?: Date): Promise<ScryptTrade[]> {
    const filters: Record<string, unknown> = {};
    if (since) filters.StartDate = since.toISOString();

    return this.connection.fetch<ScryptTrade>(ScryptMessageType.TRADE, filters);
  }

  // --- TRADING --- //

  async getPrice(from: string, to: string): Promise<Price> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);

    return Price.create(from, to, side === ScryptOrderSide.BUY ? price : 1 / price);
  }

  async getCurrentPrice(from: string, to: string): Promise<number> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);

    return side === ScryptOrderSide.BUY ? price : 1 / price;
  }

  async sell(from: string, to: string, amount: number): Promise<string> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);
    const sizeIncrement = await this.getSizeIncrement(symbol);

    // OrderQty must be in base currency
    // SELL (from=base): orderQty = amount
    // BUY (from=quote): orderQty = amount / price
    const rawQty = side === ScryptOrderSide.SELL ? amount : amount / price;
    const orderQty = Util.floorToValue(rawQty, sizeIncrement);

    return this.placeAndReturnId(symbol, side, orderQty, price);
  }

  async buy(from: string, to: string, amount: number): Promise<string> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getOrderBookPrice(symbol, side);
    const sizeIncrement = await this.getSizeIncrement(symbol);

    // OrderQty must be in base currency
    // BUY (to=base): orderQty = amount
    // SELL (to=quote): orderQty = amount / price
    const rawQty = side === ScryptOrderSide.BUY ? amount : amount / price;
    const orderQty = Util.floorToValue(rawQty, sizeIncrement);

    return this.placeAndReturnId(symbol, side, orderQty, price);
  }

  private async getSizeIncrement(symbol: string): Promise<number> {
    const security = await this.getSecurity(symbol);
    return parseFloat(security.MinSizeIncrement ?? '0.000001');
  }

  private async placeAndReturnId(
    symbol: string,
    side: ScryptOrderSide,
    orderQty: number,
    price: number,
  ): Promise<string> {
    const response = await this.placeOrder(
      symbol,
      side,
      orderQty,
      ScryptOrderType.LIMIT,
      ScryptTimeInForce.GOOD_TILL_CANCEL,
      price,
    );
    return response.id;
  }

  async getOrderStatus(clOrdId: string): Promise<ScryptOrderInfo | null> {
    const report = this.executionReports.get(clOrdId);
    if (!report) return null;

    return {
      id: report.ClOrdID,
      orderId: report.OrderID,
      symbol: report.Symbol,
      side: report.Side,
      status: report.OrdStatus,
      quantity: parseFloat(report.OrderQty) || 0,
      filledQuantity: parseFloat(report.CumQty) || 0,
      remainingQuantity: parseFloat(report.LeavesQty) || 0,
      avgPrice: report.AvgPx ? parseFloat(report.AvgPx) : undefined,
      price: report.Price ? parseFloat(report.Price) : undefined,
      rejectReason: report.OrdRejReason ?? report.Text,
    };
  }

  async checkTrade(clOrdId: string, from: string, to: string): Promise<boolean> {
    const orderInfo = await this.getOrderStatus(clOrdId);
    if (!orderInfo) {
      this.logger.verbose(`No order info for id ${clOrdId} at ${this.name} found`);
      return false;
    }

    switch (orderInfo.status) {
      case ScryptOrderStatus.NEW:
      case ScryptOrderStatus.PARTIALLY_FILLED: {
        const currentPrice = await this.getTradePrice(from, to);

        // Use tolerance for float comparison to avoid unnecessary updates due to rounding
        const priceChanged = orderInfo.price && Math.abs(currentPrice - orderInfo.price) > 0.000001;
        if (priceChanged) {
          this.logger.verbose(`Order ${clOrdId}: price changed ${orderInfo.price} -> ${currentPrice}, updating order`);

          try {
            const newId = await this.editOrder(clOrdId, from, to, orderInfo.remainingQuantity, currentPrice);
            this.logger.verbose(`Order ${clOrdId} changed to ${newId}`);
            throw new TradeChangedException(newId);
          } catch (e) {
            if (e instanceof TradeChangedException) throw e;

            // If edit fails, try to cancel and let it restart
            this.logger.verbose(`Could not update order ${clOrdId}, attempting cancel: ${e.message}`);
            try {
              await this.cancelOrder(clOrdId, from, to);
            } catch (cancelError) {
              this.logger.verbose(`Cancel also failed: ${cancelError.message}`);
            }
          }
        } else {
          this.logger.verbose(`Order ${clOrdId} open, price is still ${currentPrice}`);
        }
        return false;
      }

      case ScryptOrderStatus.CANCELED: {
        const minAmount = await this.getMinTradeAmount(from, to);
        const remaining = orderInfo.remainingQuantity;

        // If remaining amount is below minimum, consider complete
        if (remaining < minAmount) {
          this.logger.verbose(
            `Order ${clOrdId} cancelled with remaining ${remaining} < minAmount ${minAmount}, marking complete`,
          );
          return true;
        }

        // Restart order with remaining amount (already in base currency)
        const { symbol, side } = await this.getTradePair(from, to);
        const price = await this.getOrderBookPrice(symbol, side);

        this.logger.verbose(`Order ${clOrdId} cancelled, restarting with remaining ${remaining} (base currency)`);

        const response = await this.placeOrder(
          symbol,
          side,
          remaining,
          ScryptOrderType.LIMIT,
          ScryptTimeInForce.GOOD_TILL_CANCEL,
          price,
        );

        this.logger.verbose(`Order ${clOrdId} changed to ${response.id}`);
        throw new TradeChangedException(response.id);
      }

      case ScryptOrderStatus.FILLED:
        this.logger.verbose(`Order ${clOrdId} filled`);
        return true;

      case ScryptOrderStatus.REJECTED:
        throw new Error(`Order ${clOrdId} has been rejected: ${orderInfo.rejectReason ?? 'unknown reason'}`);

      case ScryptOrderStatus.PENDING_NEW:
      case ScryptOrderStatus.PENDING_CANCEL:
      case ScryptOrderStatus.PENDING_REPLACE:
        this.logger.verbose(`Order ${clOrdId} is pending (${orderInfo.status}), waiting...`);
        return false;
    }
  }

  private async getTradePrice(from: string, to: string): Promise<number> {
    const { symbol, side } = await this.getTradePair(from, to);
    return this.getOrderBookPrice(symbol, side);
  }

  private async getMinTradeAmount(from: string, to: string): Promise<number> {
    const { symbol } = await this.getTradePair(from, to);
    const security = await this.getSecurity(symbol);
    return parseFloat(security.MinimumSize ?? '0');
  }

  private async placeOrder(
    symbol: string,
    side: ScryptOrderSide,
    quantity: number,
    orderType: ScryptOrderType = ScryptOrderType.LIMIT,
    timeInForce: ScryptTimeInForce = ScryptTimeInForce.GOOD_TILL_CANCEL,
    price?: number,
  ): Promise<ScryptOrderResponse> {
    const clOrdId = randomUUID();

    // Price is required for LIMIT orders
    if (orderType === ScryptOrderType.LIMIT && price === undefined) {
      throw new Error('Price is required for LIMIT orders');
    }

    const orderData: Record<string, unknown> = {
      Symbol: symbol,
      ClOrdID: clOrdId,
      Side: side,
      OrderQty: quantity.toString(),
      OrdType: orderType,
      TimeInForce: timeInForce,
    };

    if (price !== undefined) {
      orderData.Price = price.toString();
    }

    const orderRequest = {
      type: ScryptMessageType.NEW_ORDER_SINGLE,
      data: [orderData],
    };

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      orderRequest,
      ScryptMessageType.EXECUTION_REPORT,
      (reports) => reports.find((r) => r.ClOrdID === clOrdId) ?? null,
      60000,
    );

    if (report.OrdStatus === ScryptOrderStatus.REJECTED) {
      throw new Error(`Scrypt order rejected: ${report.Text ?? report.OrdRejReason ?? 'Unknown reason'}`);
    }

    return {
      id: clOrdId,
      status: report.OrdStatus,
    };
  }

  private async cancelOrder(clOrdId: string, from: string, to: string): Promise<boolean> {
    const { symbol } = await this.getTradePair(from, to);
    const origClOrdId = clOrdId;
    const newClOrdId = randomUUID();

    const cancelRequest = {
      type: ScryptMessageType.ORDER_CANCEL_REQUEST,
      data: [
        {
          OrigClOrdID: origClOrdId,
          ClOrdID: newClOrdId,
          Symbol: symbol,
        },
      ],
    };

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      cancelRequest,
      ScryptMessageType.EXECUTION_REPORT,
      (reports) => reports.find((r) => r.OrigClOrdID === origClOrdId || r.ClOrdID === newClOrdId) ?? null,
      60000,
    );

    return report.OrdStatus === ScryptOrderStatus.CANCELED;
  }

  private async editOrder(
    clOrdId: string,
    from: string,
    to: string,
    newQuantity: number,
    newPrice: number,
  ): Promise<string> {
    const { symbol } = await this.getTradePair(from, to);
    const origClOrdId = clOrdId;
    const newClOrdId = randomUUID();

    const replaceRequest = {
      type: ScryptMessageType.ORDER_CANCEL_REPLACE_REQUEST,
      data: [
        {
          OrigClOrdID: origClOrdId,
          ClOrdID: newClOrdId,
          Symbol: symbol,
          OrderQty: newQuantity.toString(),
          Price: newPrice.toString(),
        },
      ],
    };

    const report = await this.connection.requestAndWaitForUpdate<ScryptExecutionReport>(
      replaceRequest,
      ScryptMessageType.EXECUTION_REPORT,
      (reports) => reports.find((r) => r.ClOrdID === newClOrdId) ?? null,
      60000,
    );

    if (report.OrdStatus === ScryptOrderStatus.REJECTED) {
      throw new Error(`Scrypt order edit rejected: ${report.Text ?? report.OrdRejReason ?? 'Unknown reason'}`);
    }

    return newClOrdId;
  }

  // --- MARKET DATA --- //

  async getTradePair(from: string, to: string): Promise<{ symbol: string; side: ScryptOrderSide }> {
    const securities = await this.securities;

    // Find matching pair: either from=base,to=quote (SELL base) or from=quote,to=base (BUY base)
    const security = securities.find(
      (s) => (s.BaseCurrency === from && s.QuoteCurrency === to) || (s.BaseCurrency === to && s.QuoteCurrency === from),
    );

    if (!security) {
      throw new Error(`${this.name}: pair with ${from} and ${to} not supported`);
    }

    // If 'from' is the base currency, we're selling the base; otherwise buying the base
    const side = security.BaseCurrency === from ? ScryptOrderSide.SELL : ScryptOrderSide.BUY;

    return { symbol: security.Symbol, side };
  }

  private async getSecurity(symbol: string): Promise<ScryptSecurity> {
    const securities = await this.securities;
    const security = securities.find((s) => s.Symbol === symbol);

    if (!security) {
      throw new Error(`No security info for symbol ${symbol}`);
    }

    return security;
  }

  private async getOrderBookPrice(symbol: string, side: ScryptOrderSide): Promise<number> {
    const orderBook = await this.fetchOrderBook(symbol);

    // BUY: look at offers (what sellers are asking) - best ask (lowest offer)
    // SELL: look at bids (what buyers are offering) - best bid (highest bid)
    const orders = side === ScryptOrderSide.BUY ? orderBook.offers : orderBook.bids;
    if (!orders.length)
      throw new Error(`No ${side === ScryptOrderSide.BUY ? 'offers' : 'bids'} available for ${symbol}`);

    return orders[0].price;
  }

  private async fetchOrderBook(symbol: string): Promise<ScryptOrderBook> {
    const snapshots = await this.connection.fetch<ScryptMarketDataSnapshot>(ScryptMessageType.MARKET_DATA_SNAPSHOT, {
      Symbol: symbol,
    });
    const snapshot = snapshots[0];

    if (!snapshot) {
      throw new Error(`No orderbook data for symbol ${symbol}`);
    }

    return {
      bids: snapshot.Bids.map((b) => ({ price: parseFloat(b.Price), size: parseFloat(b.Size) })),
      offers: snapshot.Offers.map((o) => ({ price: parseFloat(o.Price), size: parseFloat(o.Size) })),
    };
  }
}
