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

@Injectable()
export class NodeService {
  private readonly urls: Record<NodeType, Record<NodeMode, string>>;
  private readonly clients: Record<NodeType, Record<NodeMode, NodeClient | undefined>>;

  private readonly nodePool: Record<NodeType, Record<NodeMode, NodeClient | undefined>>;
  private readonly activeNodes: Record<NodeType, { node: NodeClient; mode: NodeMode }>;

  constructor(
    private readonly http: HttpService,
    private readonly mailService: MailService,
    scheduler: SchedulerRegistry,
  ) {
    this.urls = this.defineUrls();
    this.nodePool = this.createNodePool(scheduler);
    this.activeNodes = this.setDefaultActiveNodes();

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
      [NodeType.REF]: {
        [NodeMode.ACTIVE]: Config.node.ref.active,
        [NodeMode.PASSIVE]: Config.node.ref.passive,
      },
    };

    this.clients = {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.DEX, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.DEX, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.INT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.REF]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.REF, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.REF, NodeMode.PASSIVE, scheduler),
      },
    };
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

    if (errors.length > 0) {
      console.error(`Node errors:`, errors);
      this.resetActiveNodes(errors);
      await this.mailService.sendErrorMail(
        'Node Error',
        errors.map((e) => e.message),
      );
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
  createNodeClient(node: NodeType, mode: NodeMode, scheduler: SchedulerRegistry): NodeClient | undefined {
    return this.urls[node][mode] ? new NodeClient(this.http, this.urls[node][mode], scheduler) : undefined;
  }

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
    const client = this.clients[node][mode];
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

  private defineUrls(): Record<NodeType, Record<NodeMode, string>> {
    return {
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
      [NodeType.REF]: {
        [NodeMode.ACTIVE]: Config.node.ref.active,
        [NodeMode.PASSIVE]: Config.node.ref.passive,
      },
    };
  }

  private createNodePool(scheduler: SchedulerRegistry): Record<NodeType, Record<NodeMode, NodeClient | undefined>> {
    return {
      [NodeType.INPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INPUT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.DEX]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.DEX, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.DEX, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.OUTPUT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.OUTPUT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.INT]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.INT, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.INT, NodeMode.PASSIVE, scheduler),
      },
      [NodeType.REF]: {
        [NodeMode.ACTIVE]: this.createNodeClient(NodeType.REF, NodeMode.ACTIVE, scheduler),
        [NodeMode.PASSIVE]: this.createNodeClient(NodeType.REF, NodeMode.PASSIVE, scheduler),
      },
    };
  }

  private setDefaultActiveNodes(): Record<NodeType, { node: NodeClient; mode: NodeMode }> {
    return {
      [NodeType.INPUT]: {
        node: this.nodePool.inp.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.DEX]: {
        node: this.nodePool.dex.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.OUTPUT]: {
        node: this.nodePool.out.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.INT]: {
        node: this.nodePool.int.active,
        mode: NodeMode.ACTIVE,
      },
      [NodeType.REF]: {
        node: this.nodePool.ref.active,
        mode: NodeMode.ACTIVE,
      },
    };
  }

  private resetActiveNodes(errors: NodeError[] = []) {
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
      Object.keys(this.activeNodes).forEach((nodeType: NodeType) => {
        if (this.activeNodes[nodeType].mode === NodeMode.PASSIVE) {
          // extract to a function
          this.activeNodes[nodeType].node = this.nodePool[nodeType][NodeMode.ACTIVE];
          this.activeNodes[nodeType].mode = NodeMode.ACTIVE;
        }

        // append email message
      });

      return;
    }

    // errors would be nice to have as a map I guess, otherwise need to pop second error if any which is ugly
    errors.forEach((error) => {
      if (error.type === NodeErrorType.DOWN) {
        const activeNodeError = errors.find((e) => e.node === error.node && e.mode === NodeMode.ACTIVE);
        const passiveNodeError = errors.find((e) => e.node === error.node && e.mode === NodeMode.PASSIVE);

        const currentActiveNode = this.activeNodes[error.node];

        if (activeNodeError && passiveNodeError) {
          // warn - will be added twice in current setup
          // append email message - both are down - ALERT!
          return;
        }

        if (activeNodeError && currentActiveNode?.mode === NodeMode.ACTIVE) {
          // extract to a function
          currentActiveNode.node = this.nodePool[error.node][NodeMode.PASSIVE];
          currentActiveNode.mode = NodeMode.PASSIVE;
          // append email message - both are down - ALERT!
          return;
        }

        if (passiveNodeError && currentActiveNode?.mode === NodeMode.PASSIVE) {
          // extract to a function
          currentActiveNode.node = this.nodePool[error.node][NodeMode.ACTIVE];
          currentActiveNode.mode = NodeMode.ACTIVE;
          // append email message - both are down - ALERT!
          return;
        }
      }
    });
  }
}
