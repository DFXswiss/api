import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BehaviorSubject, Observable } from 'rxjs';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';
import { BtcClient } from './btc-client';
import { DeFiClient } from './defi-client';
import { NodeClient, NodeMode } from './node-client';

export enum NodeType {
  INPUT = 'inp',
  DEX = 'dex',
  OUTPUT = 'out',
  INT = 'int',
  REF = 'ref',
  BTC_INPUT = 'btc-inp',
  BTC_OUTPUT = 'btc-out',
}

export interface NodeError {
  message: string;
  nodeType: NodeType;
  mode?: NodeMode;
}

interface NodeCheckResult {
  errors: NodeError[];
  info: BlockchainInfo | undefined;
}

type TypedNodeClient<T> = T extends NodeType.BTC_INPUT | NodeType.BTC_OUTPUT ? BtcClient : DeFiClient;

@Injectable()
export class NodeService {
  readonly #allNodes: Map<NodeType, Record<NodeMode, NodeClient | null>> = new Map();
  readonly #connectedNodes: Map<NodeType, BehaviorSubject<NodeClient | null>> = new Map();

  constructor(private readonly http: HttpService, private readonly scheduler: SchedulerRegistry) {
    this.initAllNodes();
    this.initConnectedNodes();
  }

  // --- HEALTH CHECK API --- //

  async checkNodes(): Promise<NodeError[]> {
    return await Promise.all([
      this.checkNodePair(NodeType.INPUT),
      this.checkNodePair(NodeType.DEX),
      this.checkNodePair(NodeType.OUTPUT),
      this.checkNodePair(NodeType.INT),
      this.checkNodePair(NodeType.REF),
      this.checkNodePair(NodeType.BTC_INPUT),
      this.checkNodePair(NodeType.BTC_OUTPUT),
    ]).then((errors) => errors.reduce((prev, curr) => prev.concat(curr), []));
  }

  // --- PUBLIC API --- //

  getConnectedNode<T extends NodeType>(type: T): Observable<TypedNodeClient<T>> {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.asObservable() as Observable<TypedNodeClient<T>>;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getCurrentConnectedNode<T extends NodeType>(type: T): TypedNodeClient<T> {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.getValue() as TypedNodeClient<T>;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getNodeFromPool<T extends NodeType>(type: T, mode: NodeMode): TypedNodeClient<T> {
    const client = this.allNodes.get(type)[mode];

    if (client) {
      return client as TypedNodeClient<T>;
    }

    throw new BadRequestException(`No node for type '${type}' and mode '${mode}'`);
  }

  swapNode(type: NodeType, mode: NodeMode): void {
    if (this.isNodeClientAvailable(type, mode)) {
      console.log(`Swapped node ${type} to ${mode}`);
      this.#connectedNodes.get(type)?.next(this.#allNodes.get(type)[mode]);
    } else {
      throw new Error(`Tried to swap to node ${type} to ${mode}, but NodeClient is not available in the pool`);
    }
  }

  // --- INIT METHODS --- //

  private initAllNodes(): void {
    this.allNodes.set(NodeType.INPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.blockchain.default.inp.active, NodeType.INPUT, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(
        Config.blockchain.default.inp.passive,
        NodeType.INPUT,
        NodeMode.PASSIVE,
      ),
    });

    this.allNodes.set(NodeType.DEX, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.blockchain.default.dex.active, NodeType.DEX, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.blockchain.default.dex.passive, NodeType.DEX, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.OUTPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.blockchain.default.out.active, NodeType.OUTPUT, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(
        Config.blockchain.default.out.passive,
        NodeType.OUTPUT,
        NodeMode.PASSIVE,
      ),
    });

    this.allNodes.set(NodeType.INT, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.blockchain.default.int.active, NodeType.INT, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.blockchain.default.int.passive, NodeType.INT, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.REF, {
      [NodeMode.ACTIVE]: this.createNodeClient(Config.blockchain.default.ref.active, NodeType.REF, NodeMode.ACTIVE),
      [NodeMode.PASSIVE]: this.createNodeClient(Config.blockchain.default.ref.passive, NodeType.REF, NodeMode.PASSIVE),
    });

    this.allNodes.set(NodeType.BTC_INPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(
        Config.blockchain.default.btcInput.active,
        NodeType.BTC_INPUT,
        NodeMode.ACTIVE,
      ),
      [NodeMode.PASSIVE]: this.createNodeClient(
        Config.blockchain.default.btcInput.passive,
        NodeType.BTC_INPUT,
        NodeMode.PASSIVE,
      ),
    });

    this.allNodes.set(NodeType.BTC_OUTPUT, {
      [NodeMode.ACTIVE]: this.createNodeClient(
        Config.blockchain.default.btcInput.active,
        NodeType.BTC_OUTPUT,
        NodeMode.ACTIVE,
      ),
      [NodeMode.PASSIVE]: this.createNodeClient(
        Config.blockchain.default.btcInput.passive,
        NodeType.BTC_OUTPUT,
        NodeMode.PASSIVE,
      ),
    });
  }

  private createNodeClient(url: string | undefined, type: NodeType, mode: NodeMode): NodeClient | null {
    return url
      ? [NodeType.BTC_INPUT, NodeType.BTC_OUTPUT].includes(type)
        ? new BtcClient(this.http, url, this.scheduler, mode)
        : new DeFiClient(this.http, url, this.scheduler, mode)
      : null;
  }

  private initConnectedNodes(): void {
    this.connectedNodes.set(NodeType.INPUT, this.setConnectedNode(NodeType.INPUT));
    this.connectedNodes.set(NodeType.DEX, this.setConnectedNode(NodeType.DEX));
    this.connectedNodes.set(NodeType.OUTPUT, this.setConnectedNode(NodeType.OUTPUT));
    this.connectedNodes.set(NodeType.INT, this.setConnectedNode(NodeType.INT));
    this.connectedNodes.set(NodeType.REF, this.setConnectedNode(NodeType.REF));
    this.connectedNodes.set(NodeType.BTC_INPUT, this.setConnectedNode(NodeType.BTC_INPUT));
    this.connectedNodes.set(NodeType.BTC_OUTPUT, this.setConnectedNode(NodeType.BTC_OUTPUT));
  }

  private setConnectedNode(type: NodeType): BehaviorSubject<NodeClient | null> {
    const active = this.isNodeClientAvailable(type, NodeMode.ACTIVE);
    const passive = this.isNodeClientAvailable(type, NodeMode.PASSIVE);

    if (active) {
      if (!passive) {
        console.warn(`Warning. Node ${type} passive is not available in NodeClient pool`);
      }

      return new BehaviorSubject(this.#allNodes.get(type)[NodeMode.ACTIVE]);
    }

    if (passive && !active) {
      console.warn(`Warning. Node ${type} active is not available in NodeClient pool. Falling back to passive`);
      return new BehaviorSubject(this.#allNodes.get(type)[NodeMode.PASSIVE]);
    }

    if (!active && !passive) {
      console.warn(`Warning. Node ${type} both active and passive are not available in NodeClient pool`);
      return new BehaviorSubject(null);
    }
  }

  // --- HELPER METHODS --- //

  private async checkNodePair(node: NodeType): Promise<NodeError[]> {
    return Promise.all([this.checkNode(node, NodeMode.ACTIVE), this.checkNode(node, NodeMode.PASSIVE)]).then(
      (pairResult) => this.handleNodePairCheck(pairResult, node),
    );
  }

  private async checkNode(type: NodeType, mode: NodeMode): Promise<NodeCheckResult> {
    const client = this.#allNodes.get(type)[mode];

    if (!client) {
      return { errors: [], info: undefined };
    }

    return Util.retry(() => client.getInfo(), 4, 1000)
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

  private isNodeClientAvailable(type: NodeType, mode: NodeMode): boolean {
    return !!this.#allNodes.get(type)[mode];
  }

  // --- GETTERS --- //

  get allNodes(): Map<NodeType, Record<NodeMode, NodeClient | null>> {
    return this.#allNodes;
  }

  get connectedNodes(): Map<NodeType, BehaviorSubject<NodeClient | null>> {
    return this.#connectedNodes;
  }
}
