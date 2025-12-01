import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { ScryptTransactionStatus } from 'src/subdomains/core/liquidity-management/adapters/actions/scrypt.adapter';
import WebSocket from 'ws';
import { ExchangeRegistryService } from './exchange-registry.service';

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
  Status: string;
  Quantity: string;
  Fee?: string;
  TxHash?: string;
  RejectReason?: string;
  RejectText?: string;
  Timestamp?: string;
  TransactTime?: string;
}

interface ScryptMessage {
  reqid?: number;
  type: ScryptMessageType;
  ts?: string;
  data?: ScryptBalance[] | ScryptBalanceTransaction[];
  initial?: boolean;
  seqNum?: number;
  error?: string;
}

export interface ScryptWithdrawResponse {
  id: string;
  status: string;
}

export interface ScryptWithdrawStatus {
  id: string;
  status: string;
  txHash?: string;
  amount?: number;
  rejectReason?: string;
  rejectText?: string;
}

export enum ScryptMessageType {
  NEW_WITHDRAW_REQUEST = 'NewWithdrawRequest',
  BALANCE_TRANSACTION = 'BalanceTransaction',
  BALANCE = 'Balance',
  ERROR = 'error',
}

@Injectable()
export class ScryptService implements OnModuleInit {
  private readonly logger = new DfxLogger(ScryptService);

  private ws: WebSocket = undefined;
  private messageHandlers: Map<string, (message: ScryptMessage) => void> = new Map();

  readonly name: string = 'Scrypt';

  constructor(private readonly registry: ExchangeRegistryService) {}

  onModuleInit() {
    this.registry.addBalanceProvider(this.name, this);
  }

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

  async withdrawFunds(
    currency: string,
    amount: number,
    address: string,
    memo?: string,
  ): Promise<ScryptWithdrawResponse> {
    const clReqId = randomUUID();

    const withdrawRequest = {
      reqid: Date.now(),
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

    // Send withdrawal and wait for BalanceTransaction confirmation
    const response = await this.sendWithdrawRequest(withdrawRequest, clReqId);

    if (response.status === ScryptTransactionStatus.REJECTED)
      throw new Error(
        `Scrypt withdrawal rejected: ${response.rejectText ?? response.rejectReason ?? 'Unknown reason'}`,
      );

    return {
      id: clReqId,
      status: response.status,
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
    const subscribeMessage = {
      reqid: Date.now(),
      type: 'subscribe',
      streams: [{ name: 'BalanceTransaction' }],
    };

    const response = await this.sendWebSocketRequest(
      subscribeMessage,
      (message) => message.type === ScryptMessageType.BALANCE_TRANSACTION && message.initial === true,
    );

    return (response.data as ScryptBalanceTransaction[]) ?? [];
  }

  private async fetchBalances(currencies?: string[]): Promise<ScryptBalance[]> {
    const subscribeMessage = {
      reqid: Date.now(),
      type: 'subscribe',
      streams: [
        {
          name: 'Balance',
          ...(currencies?.length ? { Currencies: currencies } : {}),
        },
      ],
    };

    const response = await this.sendWebSocketRequest(
      subscribeMessage,
      (message) => message.type === ScryptMessageType.BALANCE && message.initial === true,
    );

    return (response.data as ScryptBalance[]) ?? [];
  }

  private async sendWithdrawRequest(
    withdrawRequest: Record<string, unknown>,
    clReqId: string,
  ): Promise<{ status: string; transactionId?: string; rejectReason?: string; rejectText?: string }> {
    await this.ensureWebSocketConnection();

    return new Promise((resolve, reject) => {
      const handlerId = `withdraw_${Util.randomString()}`;
      let subscribed = false;

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(handlerId);
        reject(new Error('Scrypt WebSocket timeout'));
      }, 60000);

      this.messageHandlers.set(handlerId, (message: ScryptMessage) => {
        if (message.type === ScryptMessageType.ERROR) {
          clearTimeout(timeout);
          this.messageHandlers.delete(handlerId);
          const errorMsg = typeof message.error === 'object' ? JSON.stringify(message.error) : message.error;
          reject(new Error(`Scrypt error: ${errorMsg}`));
          return;
        }

        // After initial subscription, send the withdraw request
        if (message.type === ScryptMessageType.BALANCE_TRANSACTION && message.initial === true && !subscribed) {
          if (message.initial === true && !subscribed) {
            subscribed = true;
            this.logger.verbose('Subscribed to BalanceTransaction, sending withdrawal request');
            this.ws!.send(JSON.stringify(withdrawRequest));
            return;
          }

          // Look for our withdrawal in BalanceTransaction updates
          if (message.data && subscribed) {
            const transactions = message.data as ScryptBalanceTransaction[];
            const ourWithdrawal = transactions.find((t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal');

            if (ourWithdrawal) {
              this.logger.verbose(
                `Found withdrawal transaction: ${ourWithdrawal.TransactionID}, status: ${ourWithdrawal.Status}`,
              );
              clearTimeout(timeout);
              this.messageHandlers.delete(handlerId);
              resolve({
                status: ourWithdrawal.Status,
                transactionId: ourWithdrawal.TransactionID,
                rejectReason: ourWithdrawal.RejectReason,
                rejectText: ourWithdrawal.RejectText,
              });
            }
          }
        }
      });

      // Subscribe to BalanceTransaction stream
      this.logger.verbose('Subscribing to BalanceTransaction stream');
      const subscribeMessage = {
        reqid: Date.now(),
        type: 'subscribe',
        streams: [{ name: 'BalanceTransaction' }],
      };
      this.ws!.send(JSON.stringify(subscribeMessage));
    });
  }

  private async sendWebSocketRequest(
    request: Record<string, unknown>,
    responseCondition: (message: ScryptMessage) => boolean,
  ): Promise<ScryptMessage> {
    await this.ensureWebSocketConnection();

    return new Promise((resolve, reject) => {
      const handlerId = `handler_${Util.randomString()}`;

      const timeout = setTimeout(() => {
        this.messageHandlers.delete(handlerId);
        reject(new Error('Scrypt WebSocket timeout'));
      }, 30000);

      this.messageHandlers.set(handlerId, (message: ScryptMessage) => {
        if (message.type === ScryptMessageType.ERROR) {
          clearTimeout(timeout);
          this.messageHandlers.delete(handlerId);
          reject(new Error(`Scrypt error: ${message.error}`));
          return;
        }

        if (responseCondition(message)) {
          clearTimeout(timeout);
          this.messageHandlers.delete(handlerId);
          resolve(message);
        }
      });

      this.logger.verbose(`Sending Scrypt request: ${request.type}`);
      this.ws!.send(JSON.stringify(request));
    });
  }

  private async ensureWebSocketConnection(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    await this.connectWebSocket();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket connection failed');
  }

  private async connectWebSocket(): Promise<void> {
    const scryptConfig = Config.scrypt;

    return new Promise((resolve, reject) => {
      const url = new URL(scryptConfig.wsUrl);
      const host = url.host;
      const path = url.pathname;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const signature = Util.createHmac(scryptConfig.apiSecret, signaturePayload, 'sha256', 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const headers = {
        ApiKey: scryptConfig.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      this.logger.verbose(`Connecting to Scrypt WebSocket: ${scryptConfig.wsUrl}`);
      const ws = new WebSocket(scryptConfig.wsUrl, { headers });

      ws.on('open', () => {
        this.logger.verbose('Scrypt WebSocket connected');
        this.ws = ws;
        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message: ScryptMessage = JSON.parse(data.toString());
          this.logger.verbose(`Scrypt message received: ${message.type}`);

          this.messageHandlers.forEach((handler) => {
            handler(message);
          });
        } catch (e) {
          this.logger.error('Failed to parse Scrypt message:', e);
        }
      });

      ws.on('error', (error) => {
        this.logger.error('Scrypt WebSocket error:', error);
        this.ws = null;
        reject(error);
      });

      ws.on('close', () => {
        this.logger.verbose('Scrypt WebSocket closed');
        this.ws = null;
      });
    });
  }
}
