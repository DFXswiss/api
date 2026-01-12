import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32m } from 'bech32';
import { BlockchainService } from '../shared/util/blockchain.service';
import { SparkClient, SparkTransaction } from './spark-client';

@Injectable()
export class SparkService extends BlockchainService {
  private readonly client: SparkClient;

  constructor() {
    super();
    this.client = new SparkClient();
  }

  getDefaultClient(): SparkClient {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<SparkTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
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
    } catch {
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
    // BIP-21 style payment URI
    return `spark:${address}?amount=${amount.toFixed(8)}`;
  }

  // --- HELPER METHODS --- //
  private getAddressPrefix(address: string): string {
    // Type guard against parameter tampering
    if (typeof address !== 'string' || address.length === 0) {
      return this.NETWORK_PREFIXES.get(SparkNetwork.MAINNET) ?? 'sp';
    }

    const separatorIndex = address.lastIndexOf('1');
    if (separatorIndex === -1) return this.NETWORK_PREFIXES.get(SparkNetwork.MAINNET) ?? 'sp';

    return address.substring(0, separatorIndex);
  }
}
