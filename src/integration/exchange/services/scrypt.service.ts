import { Injectable, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Trade, Transaction } from 'ccxt';
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

  // --- TRANSACTION SYNC (for ExchangeSyncs) --- //

  async getDeposits(_token: string, since?: Date, _chain?: string): Promise<Transaction[]> {
    const transactions = await this.fetchBalanceTransactions();
    return transactions
      .filter((t) => t.TransactionType === 'Deposit')
      .filter((t) => !since || (t.TransactTime && new Date(t.TransactTime) >= since))
      .map((t) => this.mapToCcxtTransaction(t, 'deposit'));
  }

  async getWithdrawals(_token: string, since?: Date): Promise<Transaction[]> {
    const transactions = await this.fetchBalanceTransactions();
    return transactions
      .filter((t) => t.TransactionType === 'Withdrawal')
      .filter((t) => !since || (t.TransactTime && new Date(t.TransactTime) >= since))
      .map((t) => this.mapToCcxtTransaction(t, 'withdrawal'));
  }

  private mapToCcxtTransaction(t: ScryptBalanceTransaction, type: 'deposit' | 'withdrawal'): Transaction {
    return {
      id: t.TransactionID,
      txid: t.TxHash,
      type,
      currency: t.Currency,
      amount: parseFloat(t.Quantity) || 0,
      status: this.mapScryptStatus(t.Status),
      datetime: t.TransactTime,
      timestamp: t.TransactTime ? new Date(t.TransactTime).getTime() : undefined,
      updated: t.Timestamp ? new Date(t.Timestamp).getTime() : undefined,
      fee: t.Fee ? { cost: parseFloat(t.Fee), currency: t.Currency } : undefined,
      info: { method: 'Bank Transfer', asset: t.Currency },
    } as Transaction;
  }

  private mapScryptStatus(status: ScryptTransactionStatus): string {
    switch (status) {
      case ScryptTransactionStatus.COMPLETE:
        return 'ok';
      case ScryptTransactionStatus.FAILED:
      case ScryptTransactionStatus.REJECTED:
        return 'failed';
      default:
        return 'pending';
    }
  }

  private async fetchBalanceTransactions(): Promise<ScryptBalanceTransaction[]> {
    const data = await this.connection.fetch(ScryptMessageType.BALANCE_TRANSACTION);
    return data as ScryptBalanceTransaction[];
  }

  // --- NOT IMPLEMENTED (stubs for ExchangeService compatibility) --- //

  async getTrades(_from?: string, _to?: string, _since?: Date): Promise<Trade[]> {
    throw new NotImplementedException('getTrades is not supported by Scrypt');
  }
}
