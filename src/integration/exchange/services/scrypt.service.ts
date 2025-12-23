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
}
