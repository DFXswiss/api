import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from '@scure/base';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BlockchainService } from '../shared/util/blockchain.service';

@Injectable()
export class SparkService extends BlockchainService {
  private readonly logger = new DfxLogger(SparkService);

  constructor() {
    super();
  }

  getDefaultClient(): any {
    // Spark doesn't use an external client as all operations are performed locally
    // This method is required by BlockchainService but not applicable for Spark
    return null;
  }

  async isHealthy(): Promise<boolean> {
    // Spark service is always healthy as it doesn't depend on external nodes
    // All operations are performed locally
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

      // Hash the message
      const messageHash = sha256(new TextEncoder().encode(message));

      // Parse the signature (R and S components)
      const signatureBytes = Buffer.from(signatureHex, 'hex');
      const r = signatureBytes.slice(0, 32);
      const s = signatureBytes.slice(32, 64);

      // Try all 4 possible recovery values
      for (let recovery = 0; recovery <= 3; recovery++) {
        try {
          // Create signature object with recovery bit
          const rBigInt = BigInt('0x' + Buffer.from(r).toString('hex'));
          const sBigInt = BigInt('0x' + Buffer.from(s).toString('hex'));

          const sig = new secp256k1.Signature(rBigInt, sBigInt);
          const sigWithRecovery = sig.addRecoveryBit(recovery);

          // Recover the public key
          const recoveredPubKey = sigWithRecovery.recoverPublicKey(messageHash);
          const recoveredPubKeyBytes = recoveredPubKey.toRawBytes(true); // compressed


          // Generate Spark address from recovered public key
          const generatedAddress = this.encodeSparkAddress(recoveredPubKeyBytes, address);

          // Check if generated address matches the provided address
          if (generatedAddress === address) {
            // Verify the signature with this public key
            const isValid = secp256k1.verify(Buffer.from(signatureHex, 'hex'), messageHash, recoveredPubKeyBytes);
            if (isValid) {
              this.logger.verbose(
                `Spark signature verified successfully with recovery bit ${recovery} for address ${address}`,
              );
              return true;
            }
          }
        } catch (error) {
          // Continue to next recovery value
          continue;
        }
      }

      this.logger.error(`Failed to verify Spark signature for address ${address}`);
      return false;
    } catch (error) {
      this.logger.error(`Error verifying Spark signature: ${error.message}`, error);
      return false;
    }
  }

  // --- ADDRESS ENCODING --- //
  private encodeSparkAddress(publicKey: Uint8Array, originalAddress: string): string {
    try {
      // Decode the original address to get the full payload including metadata
      const decoded = bech32m.decode(originalAddress as `${string}1${string}`, 1024);
      const originalPayload = new Uint8Array(bech32m.fromWords(decoded.words));

      // Check if the public key is contained in the original payload
      // Spark addresses may have additional metadata before the public key
      if (originalPayload.length >= 33) {
        // Search for the public key in the payload
        for (let i = 0; i <= originalPayload.length - publicKey.length; i++) {
          let match = true;
          for (let j = 0; j < publicKey.length; j++) {
            if (originalPayload[i + j] !== publicKey[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            // Found the public key in the payload, reconstruct with original metadata
            const prefix = this.getSparkPrefix(this.getNetworkFromAddress(originalAddress));
            const words = bech32m.toWords(originalPayload);
            return bech32m.encode(prefix, words, 1024);
          }
        }
      }

      // Fallback: encode just the public key
      const network = this.getNetworkFromAddress(originalAddress);
      const prefix = this.getSparkPrefix(network);
      const words = bech32m.toWords(publicKey);
      return bech32m.encode(prefix, words, 1024);
    } catch (error) {
      this.logger.error(`Error encoding Spark address: ${error.message}`);
      throw error;
    }
  }

  // --- ADDRESS VALIDATION --- //
  private readonly BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  private readonly NETWORK_PREFIXES = new Map([
    ['sp', 'mainnet'],
    ['spt', 'testnet'],
    ['sprt', 'regtest'],
    ['sps', 'signet'],
    ['spl', 'local'],
  ]);

  isValidSparkAddress(address: string): boolean {
    try {
      // Basic length check
      if (!address || address.length < 14 || address.length > 90) {
        return false;
      }

      // Find the separator '1'
      const separatorIndex = address.lastIndexOf('1');
      if (separatorIndex === -1 || separatorIndex === address.length - 1) {
        return false;
      }

      // Extract and validate prefix
      const prefix = address.substring(0, separatorIndex);
      if (!this.NETWORK_PREFIXES.has(prefix)) {
        return false;
      }

      // Validate data part contains only bech32 characters
      const dataPart = address.substring(separatorIndex + 1);
      if (!dataPart.split('').every(char => this.BECH32_CHARSET.includes(char))) {
        return false;
      }

      // Try to decode with bech32m
      const decoded = bech32m.decode(address as `${string}1${string}`, 1024);

      // Verify prefix matches
      if (decoded.prefix !== prefix) {
        return false;
      }

      // Convert to bytes and validate length
      const publicKeyBytes = new Uint8Array(bech32m.fromWords(decoded.words));

      // Should be at least 33 bytes (compressed pubkey)
      if (publicKeyBytes.length < 33) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // --- PAYMENT REQUEST --- //
  async getPaymentRequest(_address: string, _amount: number): Promise<string | undefined> {
    // Spark uses Lightning-like invoices
    // For now, return undefined as this would need integration with Spark network
    return undefined;
  }

  // --- HELPER METHODS --- //
  private getNetworkFromAddress(address: string): 'mainnet' | 'testnet' | 'regtest' | 'signet' | 'local' {
    const separatorIndex = address.lastIndexOf('1');
    if (separatorIndex === -1) return 'mainnet';

    const prefix = address.substring(0, separatorIndex);
    return this.NETWORK_PREFIXES.get(prefix) as 'mainnet' | 'testnet' | 'regtest' | 'signet' | 'local' || 'mainnet';
  }

  private getSparkPrefix(network: 'mainnet' | 'testnet' | 'regtest' | 'signet' | 'local'): string {
    // Reverse lookup in the NETWORK_PREFIXES map
    for (const [prefix, net] of this.NETWORK_PREFIXES) {
      if (net === network) {
        return prefix;
      }
    }
    return 'sp'; // Default to mainnet prefix
  }
}