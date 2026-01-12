import { BadRequestException, Injectable } from '@nestjs/common';
import { BlockchainInfo } from './node-client';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { BitcoinClient } from './bitcoin-client';

export enum BitcoinNodeType {
  BTC_INPUT = 'btc-inp',
  BTC_OUTPUT = 'btc-out',
}

export interface BitcoinError {
  message: string;
  nodeType: BitcoinNodeType;
}

interface BitcoinCheckResult {
  errors: BitcoinError[];
  info: BlockchainInfo | undefined;
}

@Injectable()
export class BitcoinService extends BlockchainService {
  private readonly allNodes: Map<BitcoinNodeType, BitcoinClient> = new Map();

  constructor(private readonly http: HttpService) {
    super();

    this.initAllNodes();
  }

  getDefaultClient(type = BitcoinNodeType.BTC_INPUT): BitcoinClient {
    return this.allNodes.get(type);
  }

  // --- HEALTH CHECK API --- //

  async checkNodes(): Promise<BitcoinError[]> {
    return Promise.all(Object.values(BitcoinNodeType).map((type) => this.checkNode(type))).then((errors) =>
      errors.reduce((prev, curr) => prev.concat(curr), []),
    );
  }

  // --- PUBLIC API --- //

  getNodeFromPool<T extends BitcoinNodeType>(type: T): BitcoinClient {
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
    this.addNode(BitcoinNodeType.BTC_INPUT, Config.blockchain.default.btcInput);
    this.addNode(BitcoinNodeType.BTC_OUTPUT, Config.blockchain.default.btcOutput);
  }

  private addNode(type: BitcoinNodeType, config: { active: string }): void {
    const client = this.createNodeClient(config.active);
    this.allNodes.set(type, client);
  }

  private createNodeClient(url: string | undefined): BitcoinClient | null {
    return url ? new BitcoinClient(this.http, url) : null;
  }

  // --- HELPER METHODS --- //

  private async checkNode(type: BitcoinNodeType): Promise<BitcoinCheckResult> {
    const client = this.allNodes.get(type);

    if (!client) {
      return { errors: [], info: undefined };
    }

    return client
      .getInfo()
      .then((info) => this.handleNodeCheckSuccess(info, type))
      .catch(() => this.handleNodeCheckError(type));
  }

  private handleNodeCheckSuccess(info: BlockchainInfo, type: BitcoinNodeType): BitcoinCheckResult {
    const result = { errors: [], info };

    if (info.blocks < info.headers - 10) {
      result.errors.push({
        message: `${type} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
        nodeType: type,
      });
    }

    return result;
  }

  private handleNodeCheckError(type: BitcoinNodeType): BitcoinCheckResult {
    return {
      errors: [{ message: `Failed to get ${type} node infos`, nodeType: type }],
      info: undefined,
    };
  }
}
