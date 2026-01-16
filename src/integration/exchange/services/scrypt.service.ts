import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetConfig } from 'src/config/config';
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
  ScryptSecurityInfo,
  ScryptTimeInForce,
  ScryptTrade,
  ScryptTransactionStatus,
  ScryptTransactionType,
  ScryptWithdrawResponse,
  ScryptWithdrawStatus,
} from '../dto/scrypt.dto';
import { ScryptMessageType, ScryptWebSocketConnection } from './scrypt-websocket-connection';

@Injectable()
export class ScryptService {
  private readonly connection: ScryptWebSocketConnection;

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

  // --- TRANSACTIONS / TRADES --- //

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

  // --- MARKET DATA --- //

  async fetchOrderBook(symbol: string): Promise<ScryptOrderBook> {
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

  async getCurrentPrice(symbol: string, side: ScryptOrderSide): Promise<number> {
    const orderBook = await this.fetchOrderBook(symbol);

    if (side === ScryptOrderSide.BUY) {
      if (!orderBook.offers.length) throw new Error(`No offers available for ${symbol}`);
      return orderBook.offers[0].price; // Best ask (lowest offer)
    } else {
      if (!orderBook.bids.length) throw new Error(`No bids available for ${symbol}`);
      return orderBook.bids[0].price; // Best bid (highest bid)
    }
  }

  // --- SECURITY INFO --- //

  async getSecurityInfo(symbol: string): Promise<ScryptSecurityInfo> {
    const securities = await this.connection.fetch<ScryptSecurity>(ScryptMessageType.SECURITY, { Symbols: [symbol] });
    const security = securities.find((s) => s.Symbol === symbol);

    if (!security) {
      throw new Error(`No security info for symbol ${symbol}`);
    }

    return {
      symbol: security.Symbol,
      minSize: parseFloat(security.MinimumSize ?? '0'),
      maxSize: parseFloat(security.MaximumSize ?? '0'),
      minPriceIncrement: parseFloat(security.MinPriceIncrement ?? '0'),
      minSizeIncrement: parseFloat(security.MinSizeIncrement ?? '0'),
    };
  }

  async getMinTradeAmount(symbol: string): Promise<number> {
    const info = await this.getSecurityInfo(symbol);
    return info.minSize;
  }

  // --- TRADING --- //

  async placeOrder(
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

  async sell(from: string, to: string, amount: number): Promise<string> {
    const symbol = `${from}/${to}`;
    const price = await this.getCurrentPrice(symbol, ScryptOrderSide.SELL);
    const response = await this.placeOrder(
      symbol,
      ScryptOrderSide.SELL,
      amount,
      ScryptOrderType.LIMIT,
      ScryptTimeInForce.GOOD_TILL_CANCEL,
      price,
    );
    return response.id;
  }

  async cancelOrder(clOrdId: string, symbol: string): Promise<boolean> {
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

  async editOrder(clOrdId: string, symbol: string, newQuantity: number, newPrice: number): Promise<string> {
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

  private async fetchExecutionReports(): Promise<ScryptExecutionReport[]> {
    return this.connection.fetch<ScryptExecutionReport>(ScryptMessageType.EXECUTION_REPORT);
  }
}
