import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';
import { BehaviorSubject, Observable } from 'rxjs';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { MailService } from 'src/shared/services/mail.service';
import { NodeClient, NodeMode } from './node-client';

export enum NodeType {
  INPUT = 'inp',
  DEX = 'dex',
  OUTPUT = 'out',
  INT = 'int',
  REF = 'ref',
}

interface NodeError {
  message: string;
  nodeType: NodeType;
  mode?: NodeMode;
}

interface NodeCheckResult {
  errors: NodeError[];
  info: BlockchainInfo | undefined;
}

type MailMessage = string;

@Injectable()
export class NodeService {
  #allNodesUp = true;

  private readonly allNodes: Map<NodeType, Record<NodeMode, NodeClient | null>> = new Map();
  private readonly connectedNodes: Map<NodeType, BehaviorSubject<NodeClient | null>> = new Map();

  constructor(
    private readonly http: HttpService,
    private readonly mailService: MailService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.initAllNodes();
    this.initConnectedNodes();
  }

  // --- JOBS --- //

  @Interval(5000)
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

  // --- PUBLIC API --- //

  getConnectedNode(type: NodeType): Observable<NodeClient> {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.asObservable();
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getNodeFromPool(type: NodeType, mode: NodeMode): NodeClient {
    const client = this.allNodes.get(type)[mode];

    if (client) {
      return client;
    }

    throw new BadRequestException(`No node for type '${type}' and mode '${mode}'`);
  }

  // --- INIT METHODS --- //

  private initAllNodes(): void {
    this.allNodes.set(NodeType.INPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.node.inp.active, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.node.inp.passive, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.DEX, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.node.dex.active, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.node.dex.passive, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.OUTPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.node.out.active, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.node.out.passive, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.INT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.node.int.active, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.node.int.passive, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.REF, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.node.ref.active, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.node.ref.passive, NodeMode.PASSIVE),
    });
  }

  private createNodeClient(url: string | undefined, mode: NodeMode): NodeClient | null {
    return url ? new NodeClient(this.http, url, this.scheduler, mode) : null;
  }

  private initConnectedNodes(): void {
    this.connectedNodes.set(NodeType.INPUT, this.setConnectedNode(NodeType.INPUT));
    this.connectedNodes.set(NodeType.DEX, this.setConnectedNode(NodeType.DEX));
    this.connectedNodes.set(NodeType.OUTPUT, this.setConnectedNode(NodeType.OUTPUT));
    this.connectedNodes.set(NodeType.INT, this.setConnectedNode(NodeType.INT));
    this.connectedNodes.set(NodeType.REF, this.setConnectedNode(NodeType.REF));
  }

  private setConnectedNode(type: NodeType): BehaviorSubject<NodeClient | null> {
    const active = this.isNodeClientAvailable(type, NodeMode.ACTIVE);
    const passive = this.isNodeClientAvailable(type, NodeMode.PASSIVE);

    if (active) {
      if (!passive) {
        console.warn(`Warning. Node ${type} passive is not available in NodeClient pool`);
      }

      return new BehaviorSubject(this.allNodes.get(type)[NodeMode.ACTIVE]);
    }

    if (passive && !active) {
      console.warn(`Warning. Node ${type} active is not available in NodeClient pool. Falling back to passive`);
      return new BehaviorSubject(this.allNodes.get(type)[NodeMode.PASSIVE]);
    }

    if (!active && !passive) {
      console.warn(`Warning. Node ${type} both active and passive are not available in NodeClient pool`);
      return null;
    }
  }

  // --- HELPER METHODS --- //

  private async checkNodePair(node: NodeType): Promise<NodeError[]> {
    return Promise.all([this.checkNode(node, NodeMode.ACTIVE), this.checkNode(node, NodeMode.PASSIVE)]).then(
      (pairResult) => this.handleNodePairCheck(pairResult, node),
    );
  }

  private async checkNode(type: NodeType, mode: NodeMode): Promise<NodeCheckResult> {
    const client = this.allNodes.get(type)[mode];

    if (!client) {
      return { errors: [], info: undefined };
    }

    return client
      .getInfo()
      .then((info) => this.handleNodeCheckSuccess(info, type, mode))
      .catch(() => this.handleNodeCheckError(type, mode));
  }

  private handleNodePairCheck(pairResult: [NodeCheckResult, NodeCheckResult], node: NodeType): NodeError[] {
    const [{ errors: activeErrors, info: activeInfo }, { errors: passiveErrors, info: passiveInfo }] = pairResult;
    const errors = activeErrors.concat(passiveErrors);

    if (activeInfo && passiveInfo && Math.abs(activeInfo.headers - passiveInfo.headers) > 10) {
      errors.push({
        message: `${node} nodes not in sync (active headers: ${activeInfo.headers}, passive headers: ${passiveInfo.headers})`,
        nodeType: node,
      });
    }

    return errors;
  }

  private handleNodeCheckSuccess(info: BlockchainInfo, type: NodeType, mode: NodeMode): NodeCheckResult {
    const result = { errors: [], info };

    if (info.blocks < info.headers - 10) {
      result.errors.push({
        message: `${type} ${mode} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
        nodeType: type,
        mode,
      });
    }

    return result;
  }

  private handleNodeCheckError(type: NodeType, mode: NodeMode): NodeCheckResult {
    return {
      errors: [{ message: `Failed to get ${type} ${mode} node infos`, nodeType: type, mode }],
      info: undefined,
    };
  }

  private async handleNodeErrors(errors: NodeError[]): Promise<void> {
    if (errors.length > 0) {
      this.#allNodesUp = false;

      console.error(`Node errors: ${errors.map((e) => e.message)}`);
    }

    const mailMessages = this.validateConnectedNodes(errors);

    if (mailMessages.length > 0) {
      await this.mailService.sendErrorMail('Node Error', mailMessages);
    }

    if (errors.length === 0 && !this.#allNodesUp) {
      // recovered from errors in previous iteration
      await this.mailService.sendErrorMail('Node Recovered', ['INFO. All Nodes are up and running again!']);
      this.#allNodesUp = true;

      console.log('All nodes recovered from errors');
    }
  }

  private validateConnectedNodes(_errors: NodeError[] = []): MailMessage[] {
    const mailMessages = [];
    const errorsByNodes = this.batchErrorsByNodes(_errors);

    errorsByNodes.forEach((errors: NodeError[] = [], type: NodeType) => {
      const { value: connectedNode } = this.connectedNodes.get(type);

      const activeNodeError = errors.find((e) => e.mode === NodeMode.ACTIVE);
      const passiveNodeError = errors.find((e) => e.mode === NodeMode.PASSIVE);

      if (!connectedNode || (errors.length === 0 && connectedNode.mode === NodeMode.ACTIVE)) {
        return;
      }

      if (
        errors.length === 0 &&
        connectedNode.mode === NodeMode.PASSIVE &&
        this.isNodeClientAvailable(type, NodeMode.ACTIVE)
      ) {
        this.swapNode(type, NodeMode.ACTIVE);

        console.log(`Node ${type} active is back up and running!`);
        mailMessages.push(`OK. Node '${type}' switched back to Active, Passive remains up.`);

        return;
      }

      if (activeNodeError && passiveNodeError) {
        mailMessages.push(`ALERT! Node '${type}' is fully down, both Active and Passive.`);

        return;
      }

      if (activeNodeError && connectedNode?.mode === NodeMode.ACTIVE) {
        if (this.isNodeClientAvailable(type, NodeMode.PASSIVE)) {
          this.swapNode(type, NodeMode.PASSIVE);
          mailMessages.push(`WARN. Node '${type}' switched to Passive, Active is down.`);
        } else {
          mailMessages.push(
            `ALERT!. Node '${type}' is fully down. Active is down, Passive is not available in the NodeClient pool`,
          );
        }

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.PASSIVE) {
        if (this.isNodeClientAvailable(type, NodeMode.ACTIVE)) {
          this.swapNode(type, NodeMode.ACTIVE);
          mailMessages.push(`WARN. Node '${type}' switched to Active, Passive is down.`);
        } else {
          mailMessages.push(
            `ALERT!. Node '${type}' is fully down. Passive is down, Active is not available in the NodeClient pool`,
          );
        }

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.ACTIVE) {
        mailMessages.push(`WARN. Node '${type}' Passive is down. Active remains up.`);

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

  private isNodeClientAvailable(type: NodeType, mode: NodeMode): boolean {
    return !!this.allNodes.get(type)[mode];
  }

  private swapNode(type: NodeType, mode: NodeMode): void {
    console.log(`Swapped node ${type} to ${mode}`);
    this.connectedNodes.get(type)?.next(this.allNodes.get(type)[mode]);
  }
}
