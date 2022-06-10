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

  private readonly allNodes: Map<NodeType, Record<NodeMode, NodeClient>> = new Map();
  private readonly connectedNodes: Map<NodeType, BehaviorSubject<NodeClient>> = new Map();

  constructor(
    private readonly http: HttpService,
    private readonly mailService: MailService,
    scheduler: SchedulerRegistry,
  ) {
    this.initAllNodes(scheduler);
    this.initConnectedNodes();
  }

  // --- JOBS --- //

  @Interval(60000)
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
    const node = this.connectedNodes.get(type);

    if (node) {
      return node.asObservable();
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

  private initAllNodes(scheduler: SchedulerRegistry): void {
    this.allNodes.set(NodeType.INPUT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.inp.active, scheduler, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.inp.passive, scheduler, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.DEX, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.dex.active, scheduler, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.dex.passive, scheduler, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.OUTPUT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.out.active, scheduler, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.out.passive, scheduler, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.INT, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.int.active, scheduler, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.int.passive, scheduler, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.REF, {
      [NodeMode.ACTIVE]: new NodeClient(this.http, Config.node.ref.active, scheduler, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: new NodeClient(this.http, Config.node.ref.passive, scheduler, NodeMode.PASSIVE),
    });
  }

  private initConnectedNodes(): void {
    this.connectedNodes.set(NodeType.INPUT, new BehaviorSubject(this.allNodes.get(NodeType.INPUT)[NodeMode.ACTIVE]));
    this.connectedNodes.set(NodeType.DEX, new BehaviorSubject(this.allNodes.get(NodeType.DEX)[NodeMode.ACTIVE]));
    this.connectedNodes.set(NodeType.OUTPUT, new BehaviorSubject(this.allNodes.get(NodeType.OUTPUT)[NodeMode.ACTIVE]));
    this.connectedNodes.set(NodeType.INT, new BehaviorSubject(this.allNodes.get(NodeType.INT)[NodeMode.ACTIVE]));
    this.connectedNodes.set(NodeType.REF, new BehaviorSubject(this.allNodes.get(NodeType.REF)[NodeMode.ACTIVE]));
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

  private validateConnectedNodes(errors: NodeError[] = []): MailMessage[] {
    const mailMessages = [];
    const errorsByNodes = this.batchErrorsByNodes(errors);

    errorsByNodes.forEach((errors: NodeError[] = [], type: NodeType) => {
      const { value: connectedNode } = this.connectedNodes.get(type);

      const activeNodeError = errors.find((e) => e.mode === NodeMode.ACTIVE);
      const passiveNodeError = errors.find((e) => e.mode === NodeMode.PASSIVE);

      if (errors.length === 0 && connectedNode.mode === NodeMode.ACTIVE) {
        return;
      }

      if (errors.length === 0 && connectedNode.mode === NodeMode.PASSIVE) {
        console.log(`Node ${type} active is back up and running!`);
        this.swapNode(type, NodeMode.ACTIVE);
        mailMessages.push(`OK. Node '${type}' switched back to Active, Passive remains up.`);

        return;
      }

      if (activeNodeError && passiveNodeError) {
        mailMessages.push(`ALERT! Node '${type}' is fully down, both Active and Passive.`);

        return;
      }

      if (activeNodeError && connectedNode?.mode === NodeMode.ACTIVE) {
        this.swapNode(type, NodeMode.PASSIVE);
        mailMessages.push(`WARN. Node '${type}' switched to Passive, Active is down.`);

        return;
      }

      if (passiveNodeError && connectedNode?.mode === NodeMode.PASSIVE) {
        this.swapNode(type, NodeMode.ACTIVE);
        mailMessages.push(`WARN. Node '${type}' switched to Active, Passive is down.`);

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

  private swapNode(type: NodeType, mode: NodeMode): void {
    console.log(`Swapped node ${type} to ${mode}`);
    this.connectedNodes.get(type)?.next(this.allNodes.get(type)[mode]);
  }
}
