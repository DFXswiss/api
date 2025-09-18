import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32m } from 'bech32';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { BlockchainService } from '../shared/util/blockchain.service';
import { SparkClient, SparkTransaction } from './spark-client';

enum SparkNetwork {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
  REG_TEST = 'regtest',
  SIGNET = 'signet',
  LOCAL = 'local',
}

// SparkNodeType removed - SPARK uses a single client unlike Bitcoin

@Injectable()
export class SparkService extends BlockchainService {
  private readonly client: SparkClient;

  constructor(private readonly http: HttpService) {
    super();
    this.client = new SparkClient(this.http);
  }

  getDefaultClient(): SparkClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.client.isHealthy();
    } catch {
      return false;
    }
  }

  // --- TRANSACTION METHODS --- //

  async getBalance(address?: string): Promise<number> {
    return this.client.getBalance(address);
  }

  async sendTransaction(
    to: string,
    amount: number,
    feeRate?: number,
  ): Promise<{ txid: string; fee: number }> {
    const effectiveFeeRate = feeRate ?? (await this.client.getNetworkFeeRate());
    return this.client.sendTransaction(to, amount, effectiveFeeRate);
  }

  async sendMany(
    outputs: { addressTo: string; amount: number }[],
    feeRate?: number,
  ): Promise<string> {
    const effectiveFeeRate = feeRate ?? (await this.client.getNetworkFeeRate());
    return this.client.sendMany(outputs, effectiveFeeRate);
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    return this.client.getTransaction(txId);
  }

  async estimateFee(blocks = 6): Promise<number> {
    const estimate = await this.client.estimateFee(blocks);
    return estimate.feerate;
  }

  async validateAddress(address: string): Promise<boolean> {
    const result = await this.client.validateAddress(address);
    return result.isvalid;
  }


  // --- SIGNATURE VERIFICATION --- //
  async verifySignature(message: string, address: string, signatureHex: string): Promise<boolean> {
    try {
      const messageHash = sha256(new TextEncoder().encode(message));
      const signatureBytes = Buffer.from(signatureHex, 'hex');

      for (let recovery = 0; recovery <= 3; recovery++) {
        const publicKey = this.recoverPublicKey(messageHash, signatureBytes, recovery);
        if (!publicKey) continue;

        const generatedAddress = this.publicKeyToAddress(publicKey, address);

        if (generatedAddress === address) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private recoverPublicKey(messageHash: Uint8Array, signatureBytes: Buffer, recovery: number): Buffer | undefined {
    try {
      const signature = secp256k1.Signature.fromBytes(signatureBytes, 'compact').addRecoveryBit(recovery);
      const recoveredPubKey = signature.recoverPublicKey(messageHash);
      return Buffer.from(recoveredPubKey.toBytes(true));
    } catch (error) {
      return undefined;
    }
  }

  private publicKeyToAddress(publicKey: Buffer, originalAddress: string): string {
    const prefix = this.getAddressPrefix(originalAddress);

    // check if the public key is contained in the original payload
    const decoded = bech32m.decode(originalAddress, 1024);
    const originalPayload = new Uint8Array(bech32m.fromWords(decoded.words));
    const originalContainsPubKey = originalPayload.length >= 33 && this.containsPublicKey(originalPayload, publicKey);

    const words = originalContainsPubKey ? bech32m.toWords(originalPayload) : bech32m.toWords(publicKey);

    return bech32m.encode(prefix, words, 1024);
  }

  private containsPublicKey(payload: Uint8Array, publicKey: Buffer): boolean {
    for (let i = 0; i <= payload.length - publicKey.length; i++) {
      if (payload.subarray(i, i + publicKey.length).every((byte, j) => byte === publicKey[j])) {
        return true;
      }
    }
    return false;
  }

  // --- PAYMENT REQUEST --- //
  async getPaymentRequest(address: string, amount: number): Promise<string | undefined> {
    // Generate Spark payment URI following BIP-21 style format
    // Format: spark:address?amount=value
    return `spark:${address}?amount=${amount.toFixed(8)}`;
  }

  // --- HELPER METHODS --- //
  private readonly NETWORK_PREFIXES = new Map<SparkNetwork, string>([
    [SparkNetwork.MAINNET, 'sp'],
    [SparkNetwork.TESTNET, 'spt'],
    [SparkNetwork.REG_TEST, 'sprt'],
    [SparkNetwork.SIGNET, 'sps'],
    [SparkNetwork.LOCAL, 'spl'],
  ]);

  private getAddressPrefix(address: string): string {
    const separatorIndex = address.lastIndexOf('1');
    if (separatorIndex === -1) return this.NETWORK_PREFIXES.get(SparkNetwork.MAINNET);

    return address.substring(0, separatorIndex);
  }
}
