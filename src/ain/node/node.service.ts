import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { MailService } from 'src/shared/services/mail.service';
import { NodeClient } from './node-client';

export enum NodeType {
  INPUT = 'inp',
  DEX = 'dex',
  OUTPUT = 'out',
  INT = 'int',
  REF = 'ref',
}

export enum NodeMode {
  ACTIVE = 'active',
  PASSIVE = 'passive',
}

interface NodeError {
  message: string;
  nodeType: NodeType;
  mode?: NodeMode;
}

interface Node {
  client: NodeClient;
  mode: NodeMode;
}

type MailMessage = string;

@Injectable()
export class NodeService {
  private readonly allNodes: Map<NodeType, Record<NodeMode, NodeClient>> = new Map();
  private readonly connectedNodes: Map<NodeType, Node> = new Map();

  constructor(
    private readonly http: HttpService,
    private readonly mailService: MailService,
    scheduler: SchedulerRegistry,
  ) {
    this.initAllNodes(scheduler);
    this.initConnectedNodes();
  }

  @Interval(900000)
  async checkNodes(): Promise<void> {
    const errors = await Promise.all([
      this.checkNodePair(NodeType.INPUT),
      this.checkNodePair(NodeType.DEX),
      this.checkNodePair(NodeType.OUTPUT),
      this.checkNodePair(NodeType.INT),
      this.checkNodePair(NodeType.REF),
    ]).then((errors) => errors.reduce((prev, curr) => prev.concat(curr), []));

    this.handleNodeErrors(errors);
  }

  getClient(type: NodeType): NodeClient {
    const node = this.connectedNodes.get(type);

    if (node?.client) {
      return node.client;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  // --- HELPER METHODS --- //
  private async checkNodePair(node: NodeType): Promise<NodeError[]> {
    return Promise.all([this.checkNode(node, NodeMode.ACTIVE), this.checkNode(node, NodeMode.PASSIVE)]).then(
      ([{ errors: activeErrors, info: activeInfo }, { errors: passiveErrors, info: passiveInfo }]) => {
        const errors = activeErrors.concat(passiveErrors);

        if (activeInfo && passiveInfo && Math.abs(activeInfo.headers - passiveInfo.headers) > 10) {
          errors.push({
            message: `${node} nodes not in sync (active headers: ${activeInfo.headers}, passive headers: ${passiveInfo.headers})`,
            nodeType: node,
          });
        }
        return errors;
      },
    );
  }

  private async checkNode(
    node: NodeType,
    mode: NodeMode,
  ): Promise<{ errors: NodeError[]; info: BlockchainInfo | undefined }> {
    const client = this.allNodes[node][mode];

    return client
      ? client
          .getInfo()
          .then((info) => ({
            errors:
              info.blocks < info.headers - 10
                ? [
                    {
                      message: `${node} ${mode} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
                      node,
                      mode,
                    },
                  ]
                : [],
            info,
          }))
          .catch(() => ({
            errors: [{ message: `Failed to get ${node} ${mode} node infos`, node, mode }],
            info: undefined,
          }))
      : { errors: [], info: undefined };
  }

  private async handleNodeErrors(errors: NodeError[]) {
    const mailMessages = this.validateConnectedNodes(errors);

    if (errors.length > 0) {
      console.error(
        `Node errors:`,
        errors.map((e) => e.message),
      );
    }

    if (mailMessages.length > 0) {
      await this.mailService.sendErrorMail('Node Error', mailMessages);
    }
  }

  private initAllNodes(scheduler: SchedulerRegistry): void {
    const { set } = this.allNodes;

    set(NodeType.INPUT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.inp.active, scheduler),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.inp.passive, scheduler),
    });

    set(NodeType.DEX, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.dex.active, scheduler),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.dex.passive, scheduler),
    });

    set(NodeType.OUTPUT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.out.active, scheduler),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.out.passive, scheduler),
    });

    set(NodeType.INT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.int.active, scheduler),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.int.passive, scheduler),
    });

    set(NodeType.REF, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.ref.active, scheduler),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.ref.passive, scheduler),
    });
  }

  private initConnectedNodes(): void {
    const { set } = this.connectedNodes;

    set(NodeType.INPUT, {
      client: this.allNodes.get(NodeType.INPUT)[NodeMode.ACTIVE],
      mode: NodeMode.ACTIVE,
    });

    set(NodeType.DEX, {
      client: this.allNodes.get(NodeType.DEX)[NodeMode.ACTIVE],
      mode: NodeMode.ACTIVE,
    });

    set(NodeType.OUTPUT, {
      client: this.allNodes.get(NodeType.OUTPUT)[NodeMode.ACTIVE],
      mode: NodeMode.ACTIVE,
    });

    set(NodeType.INT, {
      client: this.allNodes.get(NodeType.INT)[NodeMode.ACTIVE],
      mode: NodeMode.ACTIVE,
    });

    set(NodeType.REF, {
      client: this.allNodes.get(NodeType.REF)[NodeMode.ACTIVE],
      mode: NodeMode.ACTIVE,
    });
  }

  private validateConnectedNodes(errors: NodeError[] = []): MailMessage[] {
    const mailMessages = [];
    const errorsByNodes = this.batchErrorsByNodes(errors);

    errorsByNodes.forEach((errors: NodeError[] = [], type: NodeType) => {
      const connectedNode = this.connectedNodes.get(type);

      const activeNodeError = errors.find((e) => e.mode === NodeMode.ACTIVE);
      const passiveNodeError = errors.find((e) => e.mode === NodeMode.PASSIVE);

      if (errors.length === 0 && connectedNode.mode === NodeMode.ACTIVE) {
        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.PASSIVE) {
        this.swapNode(type, NodeMode.ACTIVE);
        mailMessages.push(`OK. Node '${type}' switched back to Active mode, Passive mode remains up.`);

        return;
      }

      if (activeNodeError && passiveNodeError) {
        mailMessages.push(`ALERT! Node '${type}' is fully down, both Active and Passive.`);

        return;
      }

      if (activeNodeError && connectedNode?.mode === NodeMode.ACTIVE) {
        this.swapNode(type, NodeMode.PASSIVE);
        mailMessages.push(`WARN. Node '${type}' switched to Passive mode, Active mode is down.`);

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.PASSIVE) {
        this.swapNode(type, NodeMode.ACTIVE);
        mailMessages.push(`WARN. Node '${type}' switched to Active mode, Passive mode is down.`);

        return;
      }
    });

    return mailMessages;
  }

  private batchErrorsByNodes(errors: NodeError[]): Map<NodeType, NodeError[]> {
    const batch = new Map<NodeType, NodeError[]>();

    Object.values(NodeType).forEach((type) => batch.set(type, []));

    errors.forEach((error) => {
      const existingErrors = batch.get(error.nodeType) ?? [];
      batch.set(error.nodeType, [...existingErrors, error]);
    });

    return batch;
  }

  private swapNode(type: NodeType, mode: NodeMode) {
    // rework to subscriptions to avoid silent exchange
    this.connectedNodes[type].client = this.allNodes[type][mode];
    this.connectedNodes[type].mode = mode;
  }
}
