import { BadRequestException, Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from 'bech32';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { BitcoinClient } from '../node/bitcoin-client';
import { BlockchainInfo } from '../node/rpc';

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

  static verifySilentPaymentSignature(message: string, address: string, signature: string): boolean {
    try {
      // 1. Decode SP address (bech32m) to extract B_spend public key
      const decoded = bech32m.decode(address, 1023);
      const dataBytes = Buffer.from(bech32m.fromWords(decoded.words.slice(1)));
      // SP address payload: 33 bytes B_scan + 33 bytes B_spend
      if (dataBytes.length !== 66) return false;
      const bSpend = dataBytes.subarray(33, 66);

      // 2. Compute Bitcoin Message hash: double-SHA256(prefix + varint(len) + message)
      const prefix = '\x18Bitcoin Signed Message:\n';
      const msgBytes = Buffer.from(message, 'utf8');
      const varint = BitcoinService.encodeVarint(msgBytes.length);
      const prefixBytes = Buffer.from(prefix, 'utf8');
      const payload = Buffer.concat([prefixBytes, varint, msgBytes]);
      const msgHash = sha256(sha256(payload));

      // 3. Decode signature: base64 -> 65 bytes (recoveryId + r + s)
      const sigBuf = Buffer.from(signature, 'base64');
      if (sigBuf.length !== 65) return false;
      const recoveryFlag = sigBuf[0];
      // Bitcoin signed message recovery: flag 27-30 = uncompressed, 31-34 = compressed
      const recoveryId = (recoveryFlag >= 31 ? recoveryFlag - 31 : recoveryFlag - 27) & 3;
      const r = sigBuf.subarray(1, 33);
      const s = sigBuf.subarray(33, 65);
      const sig = new secp256k1.Signature(
        BigInt('0x' + Buffer.from(r).toString('hex')),
        BigInt('0x' + Buffer.from(s).toString('hex')),
      ).addRecoveryBit(recoveryId);

      // 4. Recover public key and compare to B_spend
      const recoveredPoint = sig.recoverPublicKey(msgHash);
      const recoveredBytes = recoveredPoint.toRawBytes(true); // compressed

      return Buffer.from(recoveredBytes).equals(Buffer.from(bSpend));
    } catch {
      return false;
    }
  }

  private static encodeVarint(n: number): Buffer {
    if (n < 0xfd) return Buffer.from([n]);
    if (n <= 0xffff) {
      const buf = Buffer.alloc(3);
      buf[0] = 0xfd;
      buf.writeUInt16LE(n, 1);
      return buf;
    }
    const buf = Buffer.alloc(5);
    buf[0] = 0xfe;
    buf.writeUInt32LE(n, 1);
    return buf;
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
