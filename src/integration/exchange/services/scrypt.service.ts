import { createHmac, randomUUID } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
  type: string;
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

@Injectable()
export class ScryptService implements OnModuleInit {
  private readonly logger = new DfxLogger(ScryptService);

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
      type: 'NewWithdrawRequest',
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

    if (response.status === 'Rejected') {
      throw new Error(`Scrypt withdrawal rejected: ${response.rejectText ?? response.rejectReason ?? 'Unknown reason'}`);
    }

    return {
      id: clReqId,
      status: response.status,
    };
  }

  private async sendWithdrawRequest(
    withdrawRequest: Record<string, unknown>,
    clReqId: string,
  ): Promise<{ status: string; transactionId?: string; rejectReason?: string; rejectText?: string }> {
    const config = GetConfig().scrypt;

    if (!config.apiKey || !config.apiSecret) {
      this.logger.warn('Scrypt API credentials not configured');
      throw new Error('Scrypt API credentials not configured');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Scrypt WebSocket timeout'));
      }, 60000);

      const url = new URL(config.wsUrl);
      const host = url.host;
      const path = url.pathname;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const hmac = createHmac('sha256', config.apiSecret);
      hmac.update(signaturePayload);
      const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const headers = {
        ApiKey: config.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      this.logger.verbose(`Connecting to Scrypt WebSocket for withdrawal: ${config.wsUrl}`);
      const ws = new WebSocket(config.wsUrl, { headers });

      let subscribed = false;

      ws.on('open', () => {
        this.logger.verbose('Scrypt WebSocket connected, subscribing to BalanceTransaction stream');
        const subscribeMessage = {
          reqid: Date.now(),
          type: 'subscribe',
          streams: [{ name: 'BalanceTransaction' }],
        };
        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message: ScryptMessage = JSON.parse(data.toString());
          this.logger.verbose(`Scrypt message received: ${message.type}`);

          if (message.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            const errorMsg = typeof message.error === 'object' ? JSON.stringify(message.error) : message.error;
            reject(new Error(`Scrypt error: ${errorMsg}`));
            return;
          }

          // After initial subscription, send the withdraw request
          if (message.type === 'BalanceTransaction' && message.initial === true && !subscribed) {
            subscribed = true;
            this.logger.verbose('Subscribed to BalanceTransaction, sending withdrawal request');
            ws.send(JSON.stringify(withdrawRequest));
            return;
          }

          // Look for our withdrawal in BalanceTransaction updates
          if (message.type === 'BalanceTransaction' && message.data && subscribed) {
            const transactions = message.data as ScryptBalanceTransaction[];
            const ourWithdrawal = transactions.find(
              (t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal',
            );

            if (ourWithdrawal) {
              this.logger.verbose(`Found withdrawal transaction: ${ourWithdrawal.TransactionID}, status: ${ourWithdrawal.Status}`);
              clearTimeout(timeout);
              ws.close();
              resolve({
                status: ourWithdrawal.Status,
                transactionId: ourWithdrawal.TransactionID,
                rejectReason: ourWithdrawal.RejectReason,
                rejectText: ourWithdrawal.RejectText,
              });
            }
          }
        } catch (e) {
          this.logger.error('Failed to parse Scrypt message:', e);
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error('Scrypt WebSocket error:', error);
        reject(error);
      });

      ws.on('close', () => {
        this.logger.verbose('Scrypt WebSocket closed');
      });
    });
  }

  async getWithdrawalStatus(clReqId: string): Promise<ScryptWithdrawStatus | null> {
    const transactions = await this.fetchBalanceTransactions();
    const transaction = transactions.find(
      (t) => t.ClReqID === clReqId && t.TransactionType === 'Withdrawal',
    );

    if (!transaction) {
      return null;
    }

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

    const response = await this.sendWebSocketRequest<ScryptBalanceTransaction[]>(
      subscribeMessage,
      (message) => message.type === 'BalanceTransaction' && message.initial === true,
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

    const response = await this.sendWebSocketRequest<ScryptBalance[]>(
      subscribeMessage,
      (message) => message.type === 'Balance' && message.initial === true,
    );

    return (response.data as ScryptBalance[]) ?? [];
  }

  private async sendWebSocketRequest<T>(
    request: Record<string, unknown>,
    responseCondition: (message: ScryptMessage) => boolean,
  ): Promise<ScryptMessage> {
    const config = GetConfig().scrypt;

    if (!config.apiKey || !config.apiSecret) {
      this.logger.warn('Scrypt API credentials not configured');
      throw new Error('Scrypt API credentials not configured');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Scrypt WebSocket timeout'));
      }, 30000);

      const url = new URL(config.wsUrl);
      const host = url.host;
      const path = url.pathname;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const hmac = createHmac('sha256', config.apiSecret);
      hmac.update(signaturePayload);
      const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const headers = {
        ApiKey: config.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      this.logger.verbose(`Connecting to Scrypt WebSocket: ${config.wsUrl}`);
      const ws = new WebSocket(config.wsUrl, { headers });

      ws.on('open', () => {
        this.logger.verbose(`Scrypt WebSocket connected, sending request: ${request.type}`);
        ws.send(JSON.stringify(request));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message: ScryptMessage = JSON.parse(data.toString());
          this.logger.verbose(`Scrypt message received: ${message.type}`);

          if (message.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`Scrypt error: ${message.error}`));
            return;
          }

          if (responseCondition(message)) {
            clearTimeout(timeout);
            ws.close();
            resolve(message);
          }
        } catch (e) {
          this.logger.error('Failed to parse Scrypt message:', e);
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.logger.error('Scrypt WebSocket error:', error);
        reject(error);
      });

      ws.on('close', () => {
        this.logger.verbose('Scrypt WebSocket closed');
      });
    });
  }
}
