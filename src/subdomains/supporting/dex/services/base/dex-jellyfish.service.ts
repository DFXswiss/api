import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Config } from 'src/config/config';
import { NodeClient } from 'src/integration/blockchain/ain/node/node-client';

export abstract class DexJellyfishService {
  protected abstract getClient(): NodeClient;

  async getRecentHistory(depth: number): Promise<AccountHistory[]> {
    return this.getClient().getRecentHistory(depth, Config.blockchain.default.dexWalletAddress);
  }

  parseAmounts(amounts: string[]): { asset: string; amount: number }[] {
    return amounts.map((a) => this.getClient().parseAmount(a));
  }
}
