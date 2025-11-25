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

interface ScryptMessage {
  reqid?: number;
  type: string;
  ts?: string;
  data?: ScryptBalance[];
  initial?: boolean;
  seqNum?: number;
  error?: string;
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

  private async fetchBalances(currencies?: string[]): Promise<ScryptBalance[]> {
    const config = GetConfig().scrypt;

    if (!config.apiKey || !config.apiSecret) {
      this.logger.warn('Scrypt API credentials not configured');
      return [];
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Scrypt WebSocket timeout'));
      }, 30000);

      // Parse URL to get host and path
      const url = new URL(config.wsUrl);
      const host = url.host;
      const path = url.pathname;

      // Generate timestamp and signature for authentication
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const signaturePayload = ['GET', timestamp, host, path].join('\n');
      const hmac = createHmac('sha256', config.apiSecret);
      hmac.update(signaturePayload);
      // Use base64 and convert to url-safe (matching Python's urlsafe_b64encode which keeps padding)
      const signature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_');

      const headers = {
        ApiKey: config.apiKey,
        ApiSign: signature,
        ApiTimestamp: timestamp,
      };

      this.logger.verbose(`Connecting to Scrypt WebSocket: ${config.wsUrl}`);
      const ws = new WebSocket(config.wsUrl, { headers });

      ws.on('open', () => {
        this.logger.verbose('Scrypt WebSocket connected, subscribing to Balance...');

        // Subscribe to balance updates
        const subscribeMessage = {
          reqid: 1,
          type: 'subscribe',
          streams: [
            {
              name: 'Balance',
              ...(currencies?.length ? { Currencies: currencies } : {}),
            },
          ],
        };
        ws.send(JSON.stringify(subscribeMessage));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message: ScryptMessage = JSON.parse(data.toString());
          this.logger.verbose(`Scrypt message received: ${message.type}`);

          if (message.type === 'Balance' && message.initial && message.data) {
            clearTimeout(timeout);
            ws.close();
            resolve(message.data);
          }

          if (message.type === 'error') {
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`Scrypt error: ${message.error}`));
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
