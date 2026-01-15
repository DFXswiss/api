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
  rejectReason?: string;
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

  // --- TRADING --- //

  async placeOrder(
    symbol: string,
    side: ScryptOrderSide,
    quantity: number,
    orderType: ScryptOrderType = ScryptOrderType.MARKET,
    timeInForce: ScryptTimeInForce = ScryptTimeInForce.GOOD_TILL_CANCEL,
  ): Promise<ScryptOrderResponse> {
    const clOrdId = randomUUID();

    const orderRequest = {
      type: ScryptMessageType.NEW_ORDER_SINGLE,
      data: [
        {
          Symbol: symbol,
          ClOrdID: clOrdId,
          Side: side,
          OrderQty: quantity.toString(),
          OrdType: orderType,
          TimeInForce: timeInForce,
        },
      ],
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
    const response = await this.placeOrder(symbol, ScryptOrderSide.SELL, amount);
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
      rejectReason: report.RejectReason ?? report.Text,
    };
  }

  async checkTrade(clOrdId: string): Promise<boolean> {
    const order = await this.getOrderStatus(clOrdId);
    if (!order) return false;

    switch (order.status) {
      case ScryptOrderStatus.FILLED:
        return true;
      case ScryptOrderStatus.PARTIALLY_FILLED:
      case ScryptOrderStatus.NEW:
        return false;
      case ScryptOrderStatus.CANCELLED:
      case ScryptOrderStatus.REJECTED:
        throw new Error(`Scrypt order ${clOrdId} failed with status ${order.status}: ${order.rejectReason ?? ''}`);
      default:
        return false;
    }
  }

  private async fetchExecutionReports(): Promise<ScryptExecutionReport[]> {
    const data = await this.connection.fetch(ScryptMessageType.EXECUTION_REPORT);
    return data as ScryptExecutionReport[];
  }
}
