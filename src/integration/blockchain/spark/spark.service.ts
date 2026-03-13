import { Injectable } from '@nestjs/common';
import { Bech32mService } from '../shared/bech32m/bech32m.service';
import { SparkClient, SparkTransaction } from './spark-client';

@Injectable()
export class SparkService extends Bech32mService {
  readonly defaultPrefix = 'spark';

  private readonly client: SparkClient;

  constructor() {
    super();
    this.client = new SparkClient();
  }

  getDefaultClient(): SparkClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
