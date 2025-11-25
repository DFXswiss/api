import { createHmac } from 'crypto';
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
  Amount: string;
  Fee?: string;
  Created?: string;
  Updated?: string;
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
  txid?: string;
  amount?: number;
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
    const clReqId = `dfx-withdraw-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

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

    const response = await this.sendWebSocketRequest<{ ClReqID: string; Status: string }>(
      withdrawRequest,
      (message) => message.type === 'WithdrawRequestAck' || message.type === 'error',
    );

    if (response.type === 'error') {
      throw new Error(`Scrypt withdrawal failed: ${response.error}`);
    }

    return {
      id: clReqId,
      status: 'pending',
    };
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
      amount: parseFloat(transaction.Amount) || undefined,
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
