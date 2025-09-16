import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32m } from 'bech32';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { BlockchainService } from '../shared/util/blockchain.service';
import { SparkClient, SparkTransaction, SparkUTXO } from './spark-client';

enum SparkNetwork {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
  REG_TEST = 'regtest',
  SIGNET = 'signet',
  LOCAL = 'local',
}

export enum SparkNodeType {
  INPUT = 'Input',
  OUTPUT = 'Output',
}

@Injectable()
export class SparkService extends BlockchainService {
  private readonly clients = new Map<SparkNodeType, SparkClient>();

  constructor(private readonly http: HttpService) {
    super();
    this.initializeClients();
  }

  private initializeClients(): void {
    // Initialize input and output clients
    this.clients.set(SparkNodeType.INPUT, new SparkClient(this.http));
    this.clients.set(SparkNodeType.OUTPUT, new SparkClient(this.http));
  }

  getDefaultClient(type: SparkNodeType = SparkNodeType.OUTPUT): SparkClient {
    return this.clients.get(type);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = this.getDefaultClient();
      return await client.isHealthy();
    } catch {
      return false;
    }
  }

  // --- TRANSACTION METHODS --- //

  async getBalance(address?: string, type: SparkNodeType = SparkNodeType.OUTPUT): Promise<number> {
    const client = this.getDefaultClient(type);
    return client.getBalance(address);
  }

  async sendTransaction(
    to: string,
    amount: number,
    feeRate?: number,
    type: SparkNodeType = SparkNodeType.OUTPUT,
  ): Promise<{ txid: string; fee: number }> {
    const client = this.getDefaultClient(type);
    const effectiveFeeRate = feeRate ?? (await client.getNetworkFeeRate());
    return client.sendTransaction(to, amount, effectiveFeeRate);
  }

  async sendMany(
    outputs: { addressTo: string; amount: number }[],
    feeRate?: number,
    type: SparkNodeType = SparkNodeType.OUTPUT,
  ): Promise<string> {
    const client = this.getDefaultClient(type);
    const effectiveFeeRate = feeRate ?? (await client.getNetworkFeeRate());
    return client.sendMany(outputs, effectiveFeeRate);
  }

  async getTransaction(txId: string, type: SparkNodeType = SparkNodeType.OUTPUT): Promise<SparkTransaction> {
    const client = this.getDefaultClient(type);
    return client.getTransaction(txId);
  }

  async estimateFee(blocks = 6, type: SparkNodeType = SparkNodeType.OUTPUT): Promise<number> {
    const client = this.getDefaultClient(type);
    const estimate = await client.estimateFee(blocks);
    return estimate.feerate;
  }

  async validateAddress(address: string, type: SparkNodeType = SparkNodeType.OUTPUT): Promise<boolean> {
    const client = this.getDefaultClient(type);
    const result = await client.validateAddress(address);
    return result.isvalid;
  }

  async getUTXOs(address: string, type: SparkNodeType = SparkNodeType.OUTPUT): Promise<SparkUTXO[]> {
    const client = this.getDefaultClient(type);
    return client.getUTXOsForAddress(address);
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
  async getPaymentRequest(_address: string, _amount: number): Promise<string | undefined> {
    // TODO: requires integration with Spark network
    return undefined;
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
