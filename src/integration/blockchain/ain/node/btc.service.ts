import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { BadRequestException, Injectable } from '@nestjs/common';
import { BehaviorSubject, Observable } from 'rxjs';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { BtcClient } from './btc-client';

export enum BtcType {
  BTC_INPUT = 'btc-inp',
  BTC_OUTPUT = 'btc-out',
}

export interface BtcError {
  message: string;
  nodeType: BtcType;
}

interface BtcCheckResult {
  errors: BtcError[];
  info: BlockchainInfo | undefined;
}

@Injectable()
export class BtcService extends BlockchainService {
  private readonly logger = new DfxLogger(BtcService);

  readonly #allNodes: Map<BtcType, BtcClient> = new Map();
  readonly #connectedNodes: Map<BtcType, BehaviorSubject<BtcClient | null>> = new Map();
  readonly #subscribedNodes: Map<BtcType, BtcClient> = new Map();

  constructor(private readonly http: HttpService) {
    super();

    this.initAllNodes();
    this.initConnectedNodes();
  }

  getDefaultClient(type?: BtcType): BtcClient {
    if (!type) throw new BadRequestException('type not found');

    let btcClient = this.#subscribedNodes.get(type);
    if (btcClient) return btcClient;

    this.getConnectedNode(type).subscribe((client) => (btcClient = client));
    this.#subscribedNodes.set(type, btcClient);

    return btcClient;
  }

  // --- HEALTH CHECK API --- //

  async checkNodes(): Promise<BtcError[]> {
    return Promise.all(Object.values(BtcType).map((type) => this.checkNode(type))).then((errors) =>
      errors.reduce((prev, curr) => prev.concat(curr), []),
    );
  }

  // --- PUBLIC API --- //

  getCurrentConnectedNode<T extends BtcType>(type: T): BtcClient {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.getValue();
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getNodeFromPool<T extends BtcType>(type: T): BtcClient {
    const client = this.allNodes.get(type);

    if (client) {
      return client;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  getPaymentRequest(address: string, amount: number, label = 'DFX Off-Ramp'): string {
    return `bitcoin:${address}?amount=${Util.numberToFixedString(amount)}&label=${label}`;
  }

  // --- INIT METHODS --- //

  private initAllNodes(): void {
    this.addNodeClientPair(BtcType.BTC_INPUT, Config.blockchain.default.btcInput);
    this.addNodeClientPair(BtcType.BTC_OUTPUT, Config.blockchain.default.btcOutput);
  }

  private addNodeClientPair(type: BtcType, config: { active: string }): void {
    const client = this.createNodeClient(config.active);
    this.allNodes.set(type, client);
  }

  private createNodeClient(url: string | undefined): BtcClient | null {
    return url ? new BtcClient(this.http, url) : null;
  }

  private initConnectedNodes(): void {
    Object.values(BtcType).forEach((type) => this.connectedNodes.set(type, this.setConnectedNode(type)));
  }

  private setConnectedNode(type: BtcType): BehaviorSubject<BtcClient | null> {
    const node = this.isNodeClientAvailable(type);

    if (node) {
      return new BehaviorSubject(this.#allNodes.get(type));
    } else {
      this.logger.warn(`Warning. Node ${type} is not available in NodeClient pool`);
      return new BehaviorSubject(null);
    }
  }

  // --- HELPER METHODS --- //

  private getConnectedNode<T extends BtcType>(type: T): Observable<BtcClient> {
    const client = this.connectedNodes.get(type);

    if (client) {
      return client.asObservable();
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  private async checkNode(type: BtcType): Promise<BtcCheckResult> {
    const client = this.#allNodes.get(type);

    if (!client) {
      return { errors: [], info: undefined };
    }

    return client
      .getInfo()
      .then((info) => this.handleNodeCheckSuccess(info, type))
      .catch(() => this.handleNodeCheckError(type));
  }

  private handleNodeCheckSuccess(info: BlockchainInfo, type: BtcType): BtcCheckResult {
    const result = { errors: [], info };

    if (info.blocks < info.headers - 10) {
      result.errors.push({
        message: `${type} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
        nodeType: type,
      });
    }

    return result;
  }

  private handleNodeCheckError(type: BtcType): BtcCheckResult {
    return {
      errors: [{ message: `Failed to get ${type} node infos`, nodeType: type }],
      info: undefined,
    };
  }

  private isNodeClientAvailable(type: BtcType): boolean {
    return !!this.#allNodes.get(type);
  }

  // --- GETTERS --- //

  get allNodes(): Map<BtcType, BtcClient> {
    return this.#allNodes;
  }

  get connectedNodes(): Map<BtcType, BehaviorSubject<BtcClient | null>> {
    return this.#connectedNodes;
  }
}
