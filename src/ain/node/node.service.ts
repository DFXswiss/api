import { ApiClient } from '@defichain/jellyfish-api-core';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HttpError, HttpService } from 'src/shared/services/http.service';
import { MailService } from 'src/shared/services/mail.service';

export enum NodeType {
  INPUT = 'inp',
  DEX = 'dex',
  OUTPUT = 'out',
}

export enum NodeMode {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
}

@Injectable()
export class NodeService {
  private readonly urls: Record<NodeType, Record<NodeMode, string>>;
  private readonly clients: Record<NodeType, Record<NodeMode, ApiClient>>;

  constructor(private readonly http: HttpService, private readonly mailService: MailService) {
    this.urls = {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: process.env.NODE_INP_URL_ACTIVE,
        [NodeMode.PASSIVE]: process.env.NODE_INP_URL_PASSIVE,
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: process.env.NODE_DEX_URL_ACTIVE,
        [NodeMode.PASSIVE]: process.env.NODE_DEX_URL_PASSIVE,
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: process.env.NODE_OUT_URL_ACTIVE,
        [NodeMode.PASSIVE]: process.env.NODE_OUT_URL_PASSIVE,
      },
    };

    this.clients = {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: this.createJellyfishClient(NodeType.INPUT, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createJellyfishClient(NodeType.INPUT, NodeMode.PASSIVE),
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: this.createJellyfishClient(NodeType.DEX, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createJellyfishClient(NodeType.DEX, NodeMode.PASSIVE),
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: this.createJellyfishClient(NodeType.OUTPUT, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createJellyfishClient(NodeType.OUTPUT, NodeMode.PASSIVE),
      },
    };
  }

  @Interval(3600000)
  async checkNodes(): Promise<void> {
    const errors = await Promise.all([
      this.checkNode(NodeType.INPUT),
      this.checkNode(NodeType.DEX),
      this.checkNode(NodeType.OUTPUT),
    ]).then((errors) => errors.reduce((prev, curr) => prev.concat(curr), []));

    if (errors.length > 0) {
      console.log(`Node errors: ${errors}`);
      await this.mailService.sendNodeErrorMail(errors);
    }
  }

  async unlock(node: NodeType, mode: NodeMode, timeout = 10): Promise<any> {
    return this.callNode(node, mode, (c) =>
      c.call(NodeCommand.UNLOCK, [process.env.NODE_WALLET_PASSWORD, timeout], 'number'),
    );
  }

  async forward(node: NodeType, mode: NodeMode, command: string): Promise<any> {
    return this.http
      .post(this.urls[node][mode], command, {
        headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
      })
      .catch((error: HttpError) => error.response?.data);
  }

  async sendCommand(node: NodeType, mode: NodeMode, command: string, noAutoUnlock = false): Promise<any> {
    const cmdParts = command.split(' ');

    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    return (noAutoUnlock ? Promise.resolve() : this.unlock(node, mode))
      .then(() => this.callNode(node, mode, (c) => c.call(method, params, 'number')))
      .catch((error: HttpError) => error);
  }

  async getInfo(node: NodeType, mode: NodeMode): Promise<BlockchainInfo> {
    return this.callNode(node, mode, (c) => c.blockchain.getBlockchainInfo());
  }

  // --- HELPER METHODS --- //
  private async checkNode(node: NodeType): Promise<string[]> {
    return Promise.all([this.getNodeErrors(node, NodeMode.ACTIVE), this.getNodeErrors(node, NodeMode.PASSIVE)]).then(
      ([{ errors: activeErrors, info: activeInfo }, { errors: passiveErrors, info: passiveInfo }]) => {
        const errors = activeErrors.concat(passiveErrors);

        if (activeInfo && passiveInfo && Math.abs(activeInfo.headers - passiveInfo.headers) > 10) {
          errors.push(
            `${node} nodes not in sync (active headers: ${activeInfo.headers}, passive headers: ${passiveInfo.headers})`,
          );
        }
        return errors;
      },
    );
  }

  private async getNodeErrors(
    node: NodeType,
    mode: NodeMode,
  ): Promise<{ errors: string[]; info: BlockchainInfo | undefined }> {
    return this.getInfo(node, mode)
      .then((info) => ({
        errors:
          info.blocks < info.headers - 10
            ? [`${node} ${mode} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`]
            : [],
        info,
      }))
      .catch(() => ({ errors: [`Failed to get ${node} ${mode} node infos`], info: undefined }));
  }

  private async callNode<T>(node: NodeType, mode: NodeMode, call: (client: ApiClient) => Promise<T>): Promise<T> {
    try {
      return await call(this.clients[node][mode]);
    } catch (e) {
      // TODO: retries?
      console.log(e);
      throw new ServiceUnavailableException(e);
    }
  }

  private createJellyfishClient(node: NodeType, mode: NodeMode): ApiClient {
    return new JsonRpcClient(this.urls[node][mode], { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${process.env.NODE_USER}:${process.env.NODE_PASSWORD}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }
}
