import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetConfig } from 'src/config/config';
import { ScryptMessageType, ScryptWebSocketConnection } from './scrypt-websocket-connection';

export enum ScryptTransactionStatus {
  COMPLETE = 'Complete',
  FAILED = 'Failed',
  REJECTED = 'Rejected',
}

interface ScryptBalance {
  Currency: string;
  Amount: string;
  AvailableAmount: string;
  Equivalent?: {
    Currency: string;
    Amount: string;
    AvailableAmount: string;
  };
}

interface ScryptBalanceTransaction {
  TransactionID: string;
  ClReqID?: string;
  Currency: string;
  TransactionType: string;
  Status: ScryptTransactionStatus;
  Quantity: string;
  Fee?: string;
  TxHash?: string;
  RejectReason?: string;
  RejectText?: string;
  Timestamp?: string;
  TransactTime?: string;
}

export interface ScryptWithdrawResponse {
  id: string;
  status: ScryptTransactionStatus;
}

export interface ScryptWithdrawStatus {
  id: string;
  status: ScryptTransactionStatus;
  txHash?: string;
  amount?: number;
  rejectReason?: string;
  rejectText?: string;
}

// --- TRADING TYPES --- //

export enum ScryptOrderStatus {
  NEW = 'New',
  PARTIALLY_FILLED = 'PartiallyFilled',
  FILLED = 'Filled',
  CANCELLED = 'Cancelled',
  REJECTED = 'Rejected',
}

export enum ScryptOrderSide {
  BUY = 'Buy',
  SELL = 'Sell',
}

export enum ScryptOrderType {
  MARKET = 'Market',
  LIMIT = 'Limit',
}

export enum ScryptTimeInForce {
  FILL_AND_KILL = 'FillAndKill',
  FILL_OR_KILL = 'FillOrKill',
  GOOD_TILL_CANCEL = 'GoodTillCancel',
}

interface ScryptExecutionReport {
  ClOrdID: string;
  OrigClOrdID?: string;
  OrderID?: string;
  Symbol: string;
  Side: string;
  OrdStatus: ScryptOrderStatus;
  ExecType?: string;
  OrderQty: string;
  CumQty: string;
  LeavesQty: string;
  AvgPx?: string;
  Price?: string;
  RejectReason?: string;
  Text?: string;
}

export interface ScryptOrderResponse {
  id: string;
  status: ScryptOrderStatus;
}

export interface ScryptOrderInfo {
  id: string;
  orderId?: string;
  symbol: string;
  side: string;
  status: ScryptOrderStatus;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  avgPrice?: number;
  price?: number;
  rejectReason?: string;
}

// --- MARKET DATA TYPES --- //

interface ScryptPriceLevel {
  Price: string;
  Size: string;
}

interface ScryptMarketDataSnapshot {
  Timestamp: string;
  Symbol: string;
  Status: string;
  Bids: ScryptPriceLevel[];
  Offers: ScryptPriceLevel[];
}

export interface ScryptOrderBook {
  bids: Array<{ price: number; size: number }>;
  offers: Array<{ price: number; size: number }>;
}

// --- SECURITY TYPES --- //

interface ScryptSecurity {
  Symbol: string;
  MinimumSize?: string;
  MaximumSize?: string;
  MinPriceIncrement?: string;
  MinSizeIncrement?: string;
}

export interface ScryptSecurityInfo {
  symbol: string;
  minSize: number;
  maxSize: number;
  minPriceIncrement: number;
  minSizeIncrement: number;
}

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
    const data = await this.connection.fetch(
      ScryptMessageType.BALANCE,
      currencies?.length ? { Currencies: currencies } : undefined,
    );
    return data as ScryptBalance[];
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
      (data) => {
        const transactions = data as ScryptBalanceTransaction[];
        return transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal') ?? null;
      },
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
    const transaction = transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal');

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

  private async fetchBalanceTransactions(): Promise<ScryptBalanceTransaction[]> {
    const data = await this.connection.fetch(ScryptMessageType.BALANCE_TRANSACTION);
    return data as ScryptBalanceTransaction[];
  }

  // --- MARKET DATA --- //

  async fetchOrderBook(symbol: string): Promise<ScryptOrderBook> {
    const data = await this.connection.fetch(ScryptMessageType.MARKET_DATA_SNAPSHOT, { Symbols: [symbol] });
    const snapshots = data as ScryptMarketDataSnapshot[];
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
    const data = await this.connection.fetch(ScryptMessageType.SECURITY, { Symbols: [symbol] });
    const securities = data as ScryptSecurity[];
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
      (data) => {
        const reports = data as ScryptExecutionReport[];
        return reports.find((r) => r.ClOrdID === clOrdId) ?? null;
      },
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
      (data) => {
        const reports = data as ScryptExecutionReport[];
        return reports.find((r) => r.OrigClOrdID === origClOrdId || r.ClOrdID === newClOrdId) ?? null;
      },
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
      (data) => {
        const reports = data as ScryptExecutionReport[];
        return reports.find((r) => r.ClOrdID === newClOrdId) ?? null;
      },
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
    const data = await this.connection.fetch(ScryptMessageType.EXECUTION_REPORT);
    return data as ScryptExecutionReport[];
  }
}
