import { ApiPagedResponse, WhaleApiClient } from '@defichain/whale-api-client';
import { Transaction } from '@defichain/whale-api-client/dist/api/transactions';
import { GetConfig } from 'src/config/config';

export interface TransactionHistory {
  block: {
    hash: string;
    height: number;
    time: number;
    medianTime: number;
  };
  hid: string;
  id: string;
  script: {
    hex: string;
    type: string;
  };
  tokenId?: number;
  txid: string;
  type: string;
  typeHex: string;
  value: string;
  vout?: {
    n: number;
    txid: string;
  };
}

export interface AccountHistory {
  owner: string;
  txid: string;
  txn: number;
  type: string;
  amounts: string[];
  block: {
    height: number;
    hash: string;
    time: number;
  };
}

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

  async getAccountHistory(address: string): Promise<AccountHistory[]> {
    return await this.getAll(() => this.client.address.listAccountHistory(address, 300));
  }

  async getTransactionHistory(address: string): Promise<TransactionHistory[]> {
    return await this.getAll(() => this.client.address.listTransaction(address, 300));
  }

  private async getAll<T>(method: () => Promise<ApiPagedResponse<T>>): Promise<T[]> {
    const batches = [await method()];
    while (batches[batches.length - 1].hasNext) {
      try {
        batches.push(await this.client.paginate(batches[batches.length - 1]));
      } catch (e) {
        break;
      }
    }

    return batches.reduce((prev, curr) => prev.concat(curr), [] as T[]);
  }
}
