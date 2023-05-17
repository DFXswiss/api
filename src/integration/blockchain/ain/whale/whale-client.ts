import { WhaleApiClient } from '@defichain/whale-api-client';
import { PoolPairData } from '@defichain/whale-api-client/dist/api/poolpairs';
import { Transaction } from '@defichain/whale-api-client/dist/api/transactions';
import { GetConfig } from 'src/config/config';

export class WhaleClient {
  private readonly client: WhaleApiClient;

  constructor(url: string, public readonly index: number, client?: WhaleApiClient) {
    this.client =
      client ?? new WhaleApiClient({ network: GetConfig().whale.network, version: GetConfig().whale.version, url });
  }

  async getBalance(address: string): Promise<string> {
    return this.client.address.getBalance(address);
  }

  async getTx(txId: string): Promise<Transaction> {
    return this.client.transactions.get(txId);
  }

  async getPool(id: string): Promise<PoolPairData> {
    return this.client.poolpairs.get(id);
  }

  async getSwapPrice(fromTokenId: string, toTokenId: string): Promise<number> {
    return this.client.poolpairs.getBestPath(fromTokenId, toTokenId).then((p) => +p.estimatedReturnLessDexFees);
  }

  async getHealth(): Promise<string | undefined> {
    return this.client.stats
      .get()
      .then(() => undefined)
      .catch((e) => e.message);
  }
}
