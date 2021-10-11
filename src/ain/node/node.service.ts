import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpError, HttpService } from 'src/shared/services/http.service';

export enum NodeType {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

@Injectable()
export class NodeService {
  private readonly activeClient: ApiClient;
  private readonly passiveClient: ApiClient;

  constructor(private readonly http: HttpService) {
    this.activeClient = this.createJellyfishClient(process.env.NODE_URL_ACTIVE);
    this.passiveClient = this.createJellyfishClient(process.env.NODE_URL_PASSIVE);
  }

  async unlock(node: NodeType, timeout = 10): Promise<any> {
    return this.callNode(node, (c) =>
      c.call('walletpassphrase', [process.env.NODE_WALLET_PASSWORD, timeout], 'number'),
    );
  }

  async forward(node: NodeType, command: string): Promise<any> {
    return this.http
      .post(this.nodeUrl(node), command, {
        headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
      })
      .catch((error: HttpError) => error.response?.data);
  }

  async sendCommand(node: NodeType, command: string, noAutoUnlock = false): Promise<any> {
    const cmdParts = command.split(' ');

    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    return (noAutoUnlock ? Promise.resolve() : this.unlock(node))
      .then(() => this.callNode(node, (c) => c.call(method, params, 'number')))
      .catch((error: HttpError) => error);
  }

  async getInfo(node: NodeType): Promise<BlockchainInfo> {
    return this.callNode(node, (c) => c.blockchain.getBlockchainInfo());
  }

  async checkNodes(): Promise<string[]> {
    return Promise.all([this.getInfo(NodeType.ACTIVE), this.getInfo(NodeType.PASSIVE)])
      .then(([activeInfo, passiveInfo]) => {
        const errors = [];
        if (activeInfo.blocks < activeInfo.headers - 10) {
          errors.push(`Active node out of sync (blocks: ${activeInfo.blocks}, headers: ${activeInfo.headers})`);
        }
        if (passiveInfo.blocks < passiveInfo.headers - 10) {
          errors.push(`Passive node out of sync (blocks: ${passiveInfo.blocks}, headers: ${passiveInfo.headers})`);
        }
        if (Math.abs(activeInfo.blocks - passiveInfo.blocks) > 10) {
          errors.push(`Nodes not in sync (active blocks: ${activeInfo.blocks}, passive blocks: ${passiveInfo.blocks})`);
        }

        return errors;
      })
      .catch(() => ['Failed to get node infos']);
  }

  // --- HELPER METHODS --- //
  private client(node: NodeType): ApiClient {
    return node === NodeType.ACTIVE ? this.activeClient : this.passiveClient;
  }

  private nodeUrl(node: NodeType): string {
    return node === NodeType.ACTIVE ? process.env.NODE_URL_ACTIVE : process.env.NODE_URL_PASSIVE;
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
    const passwordHash = Buffer.from(`${process.env.NODE_USER}:${process.env.NODE_PASSWORD}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
