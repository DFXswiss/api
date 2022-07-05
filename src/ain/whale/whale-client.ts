import { WhaleApiClient } from '@defichain/whale-api-client';
import { Transaction } from '@defichain/whale-api-client/dist/api/transactions';
import { GetConfig } from 'src/config/config';

export class WhaleClient {
  private readonly client: WhaleApiClient;

  constructor() {
    this.client = this.createWhaleClient();
  }

  private createWhaleClient(): WhaleApiClient {
    return new WhaleApiClient(GetConfig().whale);
  }

  async getBalance(address: string): Promise<string> {
    return await this.client.address.getBalance(address);
  }

  async getTx(txId: string): Promise<Transaction> {
    return await this.client.transactions.get(txId);
  }
}
