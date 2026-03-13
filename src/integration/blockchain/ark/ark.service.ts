import { Injectable } from '@nestjs/common';
import { Bech32mService } from '../shared/bech32m/bech32m.service';
import { ArkClient, ArkTransaction } from './ark-client';

@Injectable()
export class ArkService extends Bech32mService {
  readonly defaultPrefix = 'ark';

  private readonly client: ArkClient;

  constructor() {
    super();
    this.client = new ArkClient();
  }

  getDefaultClient(): ArkClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<ArkTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
