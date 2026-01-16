import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
export class ScryptService {
  private readonly logger = new DfxLogger(ScryptService);
  private readonly connection: ScryptWebSocketConnection;

  private securities: ScryptSecurity[];

  readonly name: string = 'Scrypt';

  constructor() {
    const config = GetConfig().scrypt;
    this.connection = new ScryptWebSocketConnection(config.wsUrl, config.apiKey, config.apiSecret);
  }

  // --- BALANCES --- //

  async getTotalBalances(): Promise<Record<string, number>> {
    const balances = await this.fetchBalances();

    const totalBalances: Record<string, number> = {};
    for (const balance of balances) {
      totalBalances[balance.Currency] = parseFloat(balance.Amount) || 0;
    }

    return totalBalances;
  }

  async getAvailableBalance(currency: string): Promise<number> {
    const balances = await this.fetchBalances([currency]);
    const balance = balances.find((b) => b.Currency === currency);
    return balance ? parseFloat(balance.AvailableAmount) || 0 : 0;
  }

  private async fetchBalances(currencies?: string[]): Promise<ScryptBalance[]> {
    return this.connection.fetch<ScryptBalance>(
      ScryptMessageType.BALANCE,
      currencies?.length ? { Currencies: currencies } : undefined,
    );
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

  async trade(from: string, to: string, amount: number): Promise<string> {
    const { symbol, side } = await this.getTradePair(from, to);
    const price = await this.getCurrentPrice(symbol, side);
    const response = await this.placeOrder(
      symbol,
      side,
      amount,
      ScryptOrderType.LIMIT,
      ScryptTimeInForce.GOOD_TILL_CANCEL,
      price,
    );
    return response.id;
  }

  async getOrderStatus(clOrdId: string): Promise<ScryptOrderInfo | null> {
    const reports = await this.fetchExecutionReports();
    const report = reports.find((r) => r.ClOrdID === clOrdId);

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
      rejectReason: report.RejectReason ?? report.Text,
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

      case ScryptOrderStatus.CANCELLED: {
        const minAmount = await this.getMinTradeAmount(from, to);
        const remaining = orderInfo.remainingQuantity;

        // If remaining amount is below minimum, consider complete
        if (remaining < minAmount) {
          this.logger.verbose(
            `Order ${clOrdId} cancelled with remaining ${remaining} < minAmount ${minAmount}, marking complete`,
          );
          return true;
        }

        // Restart order with remaining amount
        this.logger.verbose(`Order ${clOrdId} cancelled, restarting with remaining ${remaining} ${from}`);

        const newId = await this.trade(from, to, remaining);
        this.logger.verbose(`Order ${clOrdId} changed to ${newId}`);
        throw new TradeChangedException(newId);
      }

      case ScryptOrderStatus.FILLED:
        this.logger.verbose(`Order ${clOrdId} filled`);
        return true;

      case ScryptOrderStatus.REJECTED:
        throw new Error(`Order ${clOrdId} has been rejected: ${orderInfo.rejectReason ?? 'unknown reason'}`);

      default:
        return false;
    }
  }

  private async getTradePrice(from: string, to: string): Promise<number> {
    const { symbol, side } = await this.getTradePair(from, to);
    return this.getCurrentPrice(symbol, side);
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
      throw new Error(`Scrypt order rejected: ${report.Text ?? report.RejectReason ?? 'Unknown reason'}`);
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

    return report.OrdStatus === ScryptOrderStatus.CANCELLED;
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
      throw new Error(`Scrypt order edit rejected: ${report.Text ?? report.RejectReason ?? 'Unknown reason'}`);
    }

    return newClOrdId;
  }

  private async fetchExecutionReports(): Promise<ScryptExecutionReport[]> {
    return this.connection.fetch<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT);
  }

  // --- MARKET DATA --- //

  private async getTradePair(from: string, to: string): Promise<{ symbol: string; side: ScryptOrderSide }> {
    const securities = await this.getSecurities();

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
    const securities = await this.getSecurities();
    const security = securities.find((s) => s.Symbol === symbol);

    if (!security) {
      throw new Error(`No security info for symbol ${symbol}`);
    }

    return security;
  }

  private async getSecurities(): Promise<ScryptSecurity[]> {
    if (!this.securities) {
      this.securities = await this.connection.fetch<ScryptSecurity>(ScryptMessageType.SECURITY);
    }
    return this.securities;
  }

  private async getCurrentPrice(symbol: string, side: ScryptOrderSide): Promise<number> {
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
      Symbols: [symbol],
    });
    const snapshot = snapshots.find((s) => s.Symbol === symbol);

    if (!snapshot) {
      throw new Error(`No orderbook data for symbol ${symbol}`);
    }

    return {
      bids: snapshot.Bids.map((b) => ({ price: parseFloat(b.Price), size: parseFloat(b.Size) })),
      offers: snapshot.Offers.map((o) => ({ price: parseFloat(o.Price), size: parseFloat(o.Size) })),
    };
  }
}
