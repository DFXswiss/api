import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { BtcClient } from './btc-client';
import { NodeClient } from './node-client';

export enum NodeType {
  BTC_INPUT = 'btc-inp',
  BTC_OUTPUT = 'btc-out',
}

export interface NodeError {
  message: string;
  nodeType: NodeType;
}

interface NodeCheckResult {
  errors: NodeError[];
  info: BlockchainInfo | undefined;
}

@Injectable()
export class NodeService {
  private readonly logger = new DfxLogger(NodeClient);

  readonly #allNodes: Map<NodeType, NodeClient> = new Map();
  readonly #connectedNodes: Map<NodeType, BehaviorSubject<NodeClient | null>> = new Map();

  constructor(private readonly http: HttpService) {
    this.initAllNodes();
    this.initConnectedNodes();
  }

  // --- HEALTH CHECK API --- //

  async checkNodes(): Promise<NodeError[]> {
    return Promise.all(Object.values(NodeType).map((type) => this.checkNode(type))).then((errors) =>
      errors.reduce((prev, curr) => prev.concat(curr), []),
    );
  }

  // --- PUBLIC API --- //

  getConnectedNode<T extends NodeType>(type: T): Observable<BtcClient> {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.asObservable() as Observable<BtcClient>;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getCurrentConnectedNode<T extends NodeType>(type: T): BtcClient {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.getValue() as BtcClient;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getNodeFromPool<T extends NodeType>(type: T): BtcClient {
    const client = this.allNodes.get(type);

    if (client) {
      return client as BtcClient;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getPaymentRequest(address: string, amount: number, label = 'DFX Off-Ramp'): string {
    //return `bitcoin:${address}?amount=${Util.numberToFixedString(amount)}&label=${label}`;
    return `bitcoin:${address}?amount=${amount}&label=${label}`;
  }

  // --- INIT METHODS --- //

  private initAllNodes(): void {
    this.addNodeClientPair(NodeType.BTC_INPUT, Config.blockchain.default.btcInput);
    this.addNodeClientPair(NodeType.BTC_OUTPUT, Config.blockchain.default.btcOutput);
  }

  private addNodeClientPair(type: NodeType, config: { active: string }): void {
    const client = this.createNodeClient(config.active);
    this.allNodes.set(type, client);
  }

  private createNodeClient(url: string | undefined): NodeClient | null {
    return url ? new BtcClient(this.http, url) : null;
  }

  private initConnectedNodes(): void {
    Object.values(NodeType).forEach((type) => this.connectedNodes.set(type, this.setConnectedNode(type)));
  }

  private setConnectedNode(type: NodeType): BehaviorSubject<NodeClient | null> {
    const node = this.isNodeClientAvailable(type);

    if (node) {
      return new BehaviorSubject(this.#allNodes.get(type));
    } else {
      this.logger.warn(`Warning. Node ${type} is not available in NodeClient pool`);
      return new BehaviorSubject(null);
    }
  }

  // --- HELPER METHODS --- //

  private async checkNode(type: NodeType): Promise<NodeCheckResult> {
    const client = this.#allNodes.get(type);

    if (!client) {
      return { errors: [], info: undefined };
    }

    return client
      .getInfo()
      .then((info) => this.handleNodeCheckSuccess(info, type))
      .catch(() => this.handleNodeCheckError(type));
  }

  private handleNodeCheckSuccess(info: BlockchainInfo, type: NodeType): NodeCheckResult {
    const result = { errors: [], info };

    if (info.blocks < info.headers - 10) {
      result.errors.push({
        message: `${type} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
        nodeType: type,
      });
    }

    return result;
  }

  private handleNodeCheckError(type: NodeType): NodeCheckResult {
    return {
      errors: [{ message: `Failed to get ${type} node infos`, nodeType: type }],
      info: undefined,
    };
  }

  private isNodeClientAvailable(type: NodeType): boolean {
    return !!this.#allNodes.get(type);
  }

  // --- GETTERS --- //

  get allNodes(): Map<NodeType, NodeClient> {
    return this.#allNodes;
  }

  get connectedNodes(): Map<NodeType, BehaviorSubject<NodeClient | null>> {
    return this.#connectedNodes;
  }
}
