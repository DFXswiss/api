import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bech32m } from 'bech32';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainClient } from '../shared/util/blockchain-client';
import { BlockchainService } from '../shared/util/blockchain.service';

enum SparkNetwork {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
  REG_TEST = 'regtest',
  SIGNET = 'signet',
  LOCAL = 'local',
}

@Injectable()
export class SparkService extends BlockchainService {
  private readonly logger = new DfxLogger(SparkService);

  constructor() {
    super();
  }

  getDefaultClient(): BlockchainClient {
    return null;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  // --- SIGNATURE VERIFICATION --- //
  async verifySignature(message: string, address: string, signatureHex: string): Promise<boolean> {
    try {
      // Validate inputs
      if (!message || !address || !signatureHex) {
        this.logger.error('Invalid input parameters for Spark signature verification');
        return false;
      }

      // Validate address format early
      if (!this.isValidSparkAddress(address)) {
        this.logger.error(`Invalid Spark address format: ${address}`);
        return false;
      }

      // Validate signature format (64 bytes hex = 128 chars)
      if (signatureHex.length !== 128) {
        this.logger.error(`Invalid signature length: ${signatureHex.length}, expected 128`);
        return false;
      }

      // Validate hex format
      if (!/^[0-9a-fA-F]{128}$/.test(signatureHex)) {
        this.logger.error('Invalid signature format: not a valid hex string');
        return false;
      }

      const messageHash = sha256(new TextEncoder().encode(message));

      const signatureBytes = Buffer.from(signatureHex, 'hex');

      for (let recovery = 0; recovery <= 3; recovery++) {
        const publicKey = this.recoverPublicKey(messageHash, signatureBytes, recovery);
        if (!publicKey) continue;

        const generatedAddress = this.publicKeyToAddress(publicKey, address);

        if (generatedAddress === address) {
          this.logger.verbose(
            `Spark signature verified successfully with recovery bit ${recovery} for address ${address}`,
          );
          return true;
        }
      }

      this.logger.error(`Failed to verify Spark signature for address ${address}`);
      return false;
    } catch (error) {
      this.logger.error(`Error verifying Spark signature: ${error.message}`, error);
      return false;
    }
  }

  private recoverPublicKey(messageHash: Uint8Array, signatureBytes: Buffer, recovery: number): Buffer | null {
    try {
      const signature = secp256k1.Signature.fromBytes(signatureBytes, 'compact').addRecoveryBit(recovery);
      const recoveredPubKey = signature.recoverPublicKey(messageHash);
      return Buffer.from(recoveredPubKey.toBytes(true));
    } catch (error) {
      return null;
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

  // --- ADDRESS VALIDATION --- //
  isValidSparkAddress(address: string): boolean {
    try {
      const decoded = bech32m.decode(address, 1024);

      const publicKeyBytes = new Uint8Array(bech32m.fromWords(decoded.words));
      if (publicKeyBytes.length < 33) return false;

      return true;
    } catch (error) {
      return false;
    }
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
