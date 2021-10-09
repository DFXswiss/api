import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';

export enum NodeType {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

@Injectable()
export class NodeService {
  // TODO: environment
  private readonly user = 'dfx-api';
  private readonly password = '84r_qmy927jeVbHNC6-CPFKAU02B3c9wS8KaR_LKZUM=';
  private readonly activeNodeUrl = 'https://app-dfx-node-dev.azurewebsites.net';
  private readonly passiveNodeUrl = 'https://app-dfx-node-dev-stg.azurewebsites.net';

  private readonly activeClient: ApiClient;
  private readonly passiveClient: ApiClient;

  constructor(private readonly http: HttpService) {
    this.activeClient = this.createJellyfishClient(this.activeNodeUrl);
    this.passiveClient = this.createJellyfishClient(this.passiveNodeUrl);
  }

  async forward(node: NodeType, command: string): Promise<any> {
    return this.http.post(this.nodeUrl(node), command, {
      headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
    });
  }

  async getInfo(node: NodeType): Promise<BlockchainInfo> {
    return this.callNode(node, (c) => c.blockchain.getBlockchainInfo());
  }

  // --- HELPER METHODS --- //
  private client(node: NodeType): ApiClient {
    return node === NodeType.ACTIVE ? this.activeClient : this.passiveClient;
  }

  private nodeUrl(node: NodeType): string {
    return node === NodeType.ACTIVE ? this.activeNodeUrl : this.passiveNodeUrl;
  }

  private async callNode<T>(node: NodeType, call: (client: ApiClient) => Promise<T>): Promise<T> {
    try {
      return await call(this.client(node));
    } catch (e) {
      // TODO: retries?
      console.log(e);
      throw new ServiceUnavailableException(e);
    }
  }

  private createJellyfishClient(url: string): ApiClient {
    return new JsonRpcClient(url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
