import { Injectable } from '@nestjs/common';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from '@scure/base';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class SparkService {
  private readonly logger = new DfxLogger(SparkService);

  // --- SIGNATURE VERIFICATION --- //
  async verifySignature(message: string, address: string, signatureHex: string): Promise<boolean> {
    try {
      // Validate inputs
      if (!message || !address || !signatureHex) {
        this.logger.error('Invalid input parameters for Spark signature verification');
        return false;
      }

      // Validate signature format (64 bytes hex = 128 chars)
      if (signatureHex.length !== 128) {
        this.logger.error(`Invalid signature length: ${signatureHex.length}, expected 128`);
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
      // Determine network from address prefix
      const network = this.getNetworkFromAddress(originalAddress);
      const prefix = this.getSparkPrefix(network);

      // Convert public key to 5-bit groups for bech32m
      const words = bech32m.toWords(publicKey);

      // Encode with bech32m
      return bech32m.encode(prefix, words, 1024);
    } catch (error) {
      this.logger.error(`Error encoding Spark address: ${error.message}`);
      throw error;
    }
  }

  // --- ADDRESS VALIDATION --- //
  isValidSparkAddress(address: string): boolean {
    try {
      // Check basic format
      const regex = /^sp(1|t1|rt1|s1|l1)[a-z0-9]{58,89}$/;
      if (!regex.test(address)) {
        return false;
      }

      // Try to decode the address
      const network = this.getNetworkFromAddress(address);
      const prefix = this.getSparkPrefix(network);
      const decoded = bech32m.decode(address as `${string}1${string}`, 1024);

      // Check if prefix matches
      if (decoded.prefix !== prefix) {
        return false;
      }

      // Convert back to bytes to validate
      const publicKeyBytes = new Uint8Array(bech32m.fromWords(decoded.words));

      // Valid public key should be 33 bytes (compressed) or potentially more with invoice data
      if (publicKeyBytes.length < 33) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // --- PAYMENT REQUEST --- //
  async getPaymentRequest(address: string, amount: number): Promise<string | undefined> {
    // Spark uses Lightning-like invoices
    // For now, return undefined as this would need integration with Spark network
    return undefined;
  }

  // --- HELPER METHODS --- //
  private getNetworkFromAddress(address: string): 'mainnet' | 'testnet' | 'regtest' | 'signet' | 'local' {
    if (address.startsWith('sp1')) return 'mainnet';
    if (address.startsWith('spt1')) return 'testnet';
    if (address.startsWith('sprt1')) return 'regtest';
    if (address.startsWith('sps1')) return 'signet';
    if (address.startsWith('spl1')) return 'local';

    // Default to mainnet if not recognized
    return 'mainnet';
  }

  private getSparkPrefix(network: 'mainnet' | 'testnet' | 'regtest' | 'signet' | 'local'): string {
    const prefixes = {
      mainnet: 'sp',
      testnet: 'spt',
      regtest: 'sprt',
      signet: 'sps',
      local: 'spl',
    };

    return prefixes[network];
  }
}