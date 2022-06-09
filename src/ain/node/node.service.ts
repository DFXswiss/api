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

enum NodeErrorType {
  NOT_IN_SYNC = 'not-in-sync',
  DOWN = 'down',
}

interface NodeError {
  message: string;
  type: NodeErrorType;
  node: NodeType;
  mode?: NodeMode;
}

interface Node {
  client: NodeClient;
  mode: NodeMode;
}

@Injectable()
export class NodeService {
  private readonly nodePool: Record<NodeType, Record<NodeMode, NodeClient>>;
  private readonly clients: Record<NodeType, Node>;

  constructor(
    private readonly http: HttpService,
    private readonly mailService: MailService,
    scheduler: SchedulerRegistry,
  ) {
    this.nodePool = this.createNodePool(scheduler);
    this.clients = this.setDefaultClients();
  }

  @Interval(900000)
  async checkNodes(): Promise<void> {
    const errors = await Promise.all([
      this.checkNode(NodeType.INPUT),
      this.checkNode(NodeType.DEX),
      this.checkNode(NodeType.OUTPUT),
      this.checkNode(NodeType.INT),
      this.checkNode(NodeType.REF),
    ]).then((errors) => errors.reduce((prev, curr) => prev.concat(curr), []));

    this.handleNodeErrors(errors);
  }

  getClient(type: NodeType): NodeClient {
    const node = this.clients[type];

    if (node?.client) {
      return node.client;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  // --- HELPER METHODS --- //
  // health checks
  private async checkNode(node: NodeType): Promise<NodeError[]> {
    return Promise.all([this.getNodeErrors(node, NodeMode.ACTIVE), this.getNodeErrors(node, NodeMode.PASSIVE)]).then(
      ([{ errors: activeErrors, info: activeInfo }, { errors: passiveErrors, info: passiveInfo }]) => {
        const errors = activeErrors.concat(passiveErrors);

        if (activeInfo && passiveInfo && Math.abs(activeInfo.headers - passiveInfo.headers) > 10) {
          errors.push({
            message: `${node} nodes not in sync (active headers: ${activeInfo.headers}, passive headers: ${passiveInfo.headers})`,
            type: NodeErrorType.NOT_IN_SYNC,
            node,
          });
        }
        return errors;
      },
    );
  }

  private async getNodeErrors(
    node: NodeType,
    mode: NodeMode,
  ): Promise<{ errors: NodeError[]; info: BlockchainInfo | undefined }> {
    const client = this.nodePool[node][mode];
    return client
      ? client
          .getInfo()
          .then((info) => ({
            errors:
              info.blocks < info.headers - 10
                ? [
                    {
                      message: `${node} ${mode} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
                      type: NodeErrorType.NOT_IN_SYNC,
                      node,
                      mode,
                    },
                  ]
                : [],
            info,
          }))
          .catch(() => ({
            errors: [{ message: `Failed to get ${node} ${mode} node infos`, type: NodeErrorType.DOWN, node, mode }],
            info: undefined,
          }))
      : { errors: [], info: undefined };
  }

  private async handleNodeErrors(errors: NodeError[]) {
    if (errors.length > 0) {
      console.error(`Node errors:`, errors);

      this.checkClients(errors);

      await this.mailService.sendErrorMail(
        'Node Error',
        errors.map((e) => e.message),
      );
    }
  }

  private createNodePool(scheduler: SchedulerRegistry): Record<NodeType, Record<NodeMode, NodeClient>> {
    return {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.inp.active, scheduler),
        [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.inp.passive, scheduler),
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.dex.active, scheduler),
        [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.dex.passive, scheduler),
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.out.active, scheduler),
        [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.out.passive, scheduler),
      },
      [NodeType.INT]: {
        [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.int.active, scheduler),
        [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.int.passive, scheduler),
      },
      [NodeType.REF]: {
        [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.ref.active, scheduler),
        [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.ref.passive, scheduler),
      },
    };
  }

  private setDefaultClients(): Record<NodeType, Node> {
    return {
      [NodeType.INPUT]: {
        client: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.DEX]: {
        client: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.OUTPUT]: {
        client: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.INT]: {
        client: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.REF]: {
        client: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
    };
  }

  private checkClients(errors: NodeError[] = []) {
    // if no errors, check if there are some passive nodes that need to be switched back to active
    // after check and if needed switch back to active (and sending mail) -> return

    // if there are errors:
    // if error type is down OR ??? node out of sync
    // get both possible errors for a node type
    // get activeNode for a node type
    // if both active and passive errors out - one mail
    // if only active down && activeNode is set to active - switch to passive
    // if only passive down && activeNode is set to passive - switch to active

    if (errors.length === 0) {
      Object.keys(this.clients).forEach((nodeType: NodeType) => {
        if (this.clients[nodeType].mode === NodeMode.PASSIVE) {
          this.swapNode(nodeType, NodeMode.ACTIVE);
        }

        // append email message
      });

      return;
    }

    // errors would be nice to have as a map I guess, otherwise need to pop second error if any which is ugly
    errors.forEach((error) => {
      if (error.type === NodeErrorType.DOWN && error.type === NodeErrorType.NOT_IN_SYNC) {
        const activeNodeError = errors.find((e) => e.node === error.node && e.mode === NodeMode.ACTIVE);
        const passiveNodeError = errors.find((e) => e.node === error.node && e.mode === NodeMode.PASSIVE);

        const currentActiveNode = this.clients[error.node];

        if (activeNodeError && passiveNodeError) {
          // warn - will be added twice in current setup
          // append email message - both are down - ALERT!
          return;
        }

        if (activeNodeError && currentActiveNode?.mode === NodeMode.ACTIVE) {
          this.swapNode(error.node, NodeMode.PASSIVE);
          // append email message - both are down - ALERT!
          return;
        }

        if (passiveNodeError && currentActiveNode?.mode === NodeMode.PASSIVE) {
          this.swapNode(error.node, NodeMode.ACTIVE);
          // append email message - both are down - ALERT!
          return;
        }
      }
    });
  }

  private swapNode(type: NodeType, mode: NodeMode) {
    this.clients[type].client = this.nodePool[type][mode];
    this.clients[type].mode = mode;
  }
}
