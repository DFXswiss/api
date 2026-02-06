import { BadRequestException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainInfo } from '../bitcoin/node/rpc';
import { BlockchainService } from '../shared/util/blockchain.service';
import { BitcoinTestnet4Client } from './bitcoin-testnet4-client';

export enum BitcoinTestnet4NodeType {
  BTC_TESTNET4_OUTPUT = 'btc-testnet4-out',
}

export interface BitcoinTestnet4Error {
  message: string;
  nodeType: BitcoinTestnet4NodeType;
}

interface BitcoinTestnet4CheckResult {
  errors: BitcoinTestnet4Error[];
  info: BlockchainInfo | undefined;
}

@Injectable()
export class BitcoinTestnet4Service extends BlockchainService {
  private readonly allNodes: Map<BitcoinTestnet4NodeType, BitcoinTestnet4Client> = new Map();

  constructor(private readonly http: HttpService) {
    super();

    this.initAllNodes();
  }

  getDefaultClient(type = BitcoinTestnet4NodeType.BTC_TESTNET4_OUTPUT): BitcoinTestnet4Client {
    return this.allNodes.get(type);
  }

  // --- HEALTH CHECK API --- //

  async checkNodes(): Promise<BitcoinTestnet4Error[]> {
    return Promise.all(Object.values(BitcoinTestnet4NodeType).map((type) => this.checkNode(type))).then((errors) =>
      errors.reduce((prev, curr) => prev.concat(curr), []),
    );
  }

  // --- PUBLIC API --- //

  getNodeFromPool<T extends BitcoinTestnet4NodeType>(type: T): BitcoinTestnet4Client {
    const client = this.allNodes.get(type);

    if (client) {
      return client;
    }

    throw new BadRequestException(`No node for type '${type}'`);
  }

  // --- INIT METHODS --- //

  private initAllNodes(): void {
    this.addNode(BitcoinTestnet4NodeType.BTC_TESTNET4_OUTPUT, Config.blockchain.bitcoinTestnet4.btcTestnet4Output);
  }

  private addNode(type: BitcoinTestnet4NodeType, config: { active: string }): void {
    const client = this.createNodeClient(config.active);
    this.allNodes.set(type, client);
  }

  private createNodeClient(url: string | undefined): BitcoinTestnet4Client | null {
    return url ? new BitcoinTestnet4Client(this.http, url) : null;
  }

  // --- HELPER METHODS --- //

  private async checkNode(type: BitcoinTestnet4NodeType): Promise<BitcoinTestnet4CheckResult> {
    const client = this.allNodes.get(type);

    if (!client) {
      return { errors: [], info: undefined };
    }

    return client
      .getInfo()
      .then((info) => this.handleNodeCheckSuccess(info, type))
      .catch(() => this.handleNodeCheckError(type));
  }

  private handleNodeCheckSuccess(info: BlockchainInfo, type: BitcoinTestnet4NodeType): BitcoinTestnet4CheckResult {
    const result = { errors: [], info };

    if (info.blocks < info.headers - 10) {
      result.errors.push({
        message: `${type} node out of sync (blocks: ${info.blocks}, headers: ${info.headers})`,
        nodeType: type,
      });
    }

    return result;
  }

  private handleNodeCheckError(type: BitcoinTestnet4NodeType): BitcoinTestnet4CheckResult {
    return {
      errors: [{ message: `Failed to get ${type} node infos`, nodeType: type }],
      info: undefined,
    };
  }
}
