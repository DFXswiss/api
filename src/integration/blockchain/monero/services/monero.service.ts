import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { MoneroClient } from '../monero-client';

@Injectable()
export class MoneroService extends BlockchainService {
  private readonly client: MoneroClient;

  constructor(private readonly http: HttpService) {
    super();
    this.client = new MoneroClient(http);
  }

  getDefaultClient(): MoneroClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.client.getInfo();

      if (!info) return false;
      if (!info.synchronized || info.offline) return false;
      if ('OK' !== info.status) return false;

      return true;
    } catch {
      return false;
    }
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return this.client.verifySignature(message, address, signature).then((v) => v.good);
  }

  getPaymentRequest(address: string, amount: number): string {
    return `monero:${address}?tx_amount=${amount}`;
  }
}
