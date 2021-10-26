import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { ServiceUnavailableException } from '@nestjs/common';
import { HttpError, HttpService } from 'src/shared/services/http.service';

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
}

export class NodeClient {
  private readonly client: ApiClient;

  constructor(private readonly http: HttpService, private readonly url: string) {
    this.client = this.createJellyfishClient();
  }

  async getInfo(): Promise<BlockchainInfo> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo());
  }

  async unlock(timeout = 10): Promise<any> {
    return this.callNode((c) => c.call(NodeCommand.UNLOCK, [process.env.NODE_WALLET_PASSWORD, timeout], 'number'));
  }

  async sendRpcCommand(command: string): Promise<any> {
    return this.http
      .post(this.url, command, {
        headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
      })
      .catch((error: HttpError) => error.response?.data);
  }

  async sendCliCommand(command: string, noAutoUnlock: boolean): Promise<any> {
    const cmdParts = command.split(' ');

    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    return (noAutoUnlock ? Promise.resolve() : this.unlock())
      .then(() => this.callNode((c) => c.call(method, params, 'number')))
      .catch((error: HttpError) => error);
  }

  async call<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    return this.callNode<T>(call);
  }

  // --- HELPER METHODS --- //
  private async callNode<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    try {
      return await call(this.client);
    } catch (e) {
      // TODO: retries?
      console.warn('Exception during node call:', e);
      throw new ServiceUnavailableException(e);
    }
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${process.env.NODE_USER}:${process.env.NODE_PASSWORD}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
