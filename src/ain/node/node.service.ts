import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { MailService } from 'src/shared/services/mail.service';
import { NodeClient } from './node-client';

export enum NodeType {
  INPUT = 'inp',
  DEX = 'dex',
  OUTPUT = 'out',
  INT = 'int',
}

export enum NodeMode {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

@Injectable()
export class NodeService {
  private readonly urls: Record<NodeType, Record<NodeMode, string>>;
  private readonly clients: Record<NodeType, Record<NodeMode, NodeClient | undefined>>;

  constructor(private readonly http: HttpService, private readonly mailService: MailService) {
    this.urls = {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: Config.node.inp.active,
        [NodeMode.PASSIVE]: Config.node.inp.passive,
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: Config.node.dex.active,
        [NodeMode.PASSIVE]: Config.node.dex.passive,
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: Config.node.out.active,
        [NodeMode.PASSIVE]: Config.node.out.passive,
      },
      [NodeType.INT]: {
        [NodeMode.ACTIVE]: Config.node.int.active,
        [NodeMode.PASSIVE]: Config.node.int.passive,
      },
    };

    this.clients = {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.PASSIVE),
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.DEX, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.DEX, NodeMode.PASSIVE),
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.PASSIVE),
      },
      [NodeType.INT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INT, NodeMode.ACTIVE),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INT, NodeMode.PASSIVE),
      },
    };
  }

  @Interval(3600000)
  async checkNodes(): Promise<void> {
    const errors = await Promise.all([
      this.checkNode(NodeType.INPUT),
      this.checkNode(NodeType.DEX),
      this.checkNode(NodeType.OUTPUT),
      this.checkNode(NodeType.INT),
    ]).then((errors) => errors.reduce((prev, curr) => prev.concat(curr), []));

    if (errors.length > 0) {
      console.error(`Node errors:`, errors);
      await this.mailService.sendErrorMail('Node error', errors);
    }
  }

  getClient(node: NodeType, mode: NodeMode): NodeClient {
    const client = this.clients[node][mode];
    if (client) {
      return client;
    }

    throw new BadRequestException(`No node for type '${node}' and mode '${mode}'`);
  }

  // --- HELPER METHODS --- //

  // utility
  createNodeClient(node: NodeType, mode: NodeMode): NodeClient | undefined {
    return this.urls[node][mode] ? new NodeClient(this.http, this.urls[node][mode]) : undefined;
  }

  // health checks
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
    const client = this.clients[node][mode];
    return client
      ? client
          .getInfo()
          .then((info) => ({
            errors:
              info.blocks < info.headers - 10
                ? [`${node} ${mode} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`]
                : [],
            info,
          }))
          .catch(() => ({ errors: [`Failed to get ${node} ${mode} node infos`], info: undefined }))
      : { errors: [], info: undefined };
  }
}
