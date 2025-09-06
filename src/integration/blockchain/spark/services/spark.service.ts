import { Injectable } from '@nestjs/common';
import { verify } from 'bitcoinjs-message';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class SparkService {
  private readonly logger = new DfxLogger(SparkService);
  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    try {
      // Spark uses Bitcoin-compatible message signing with bech32m addresses
      // We need to convert Spark addresses (sp1...) to Bitcoin addresses (bc1...) for verification
      
      // Convert Spark address to Bitcoin address
      const bitcoinAddress = this.convertSparkToBitcoinAddress(address);
      if (!bitcoinAddress) {
        this.logger.error(`Failed to convert Spark address to Bitcoin address: ${address}`);
        return false;
      }
      
      let isValid = false;
      
      try {
        // Try standard Bitcoin message verification with strict flag
        isValid = verify(message, bitcoinAddress, signature, null, true);
      } catch {
        // Silent catch - try without strict flag
      }
      
      if (!isValid) {
        try {
          // Try without strict flag for compatibility with different wallet implementations
          isValid = verify(message, bitcoinAddress, signature, null, false);
        } catch {
          // Silent catch - signature verification failed
        }
      }
      
      // If still not valid, try with explicit Bitcoin mainnet prefix
      if (!isValid) {
        try {
          const bitcoinPrefix = '\x18Bitcoin Signed Message:\n';
          isValid = verify(message, bitcoinAddress, signature, bitcoinPrefix, true);
        } catch {
          // Silent catch
        }
      }
      
      return isValid;
    } catch (error) {
      this.logger.error(`Spark signature verification failed: ${error}`);
      return false;
    }
  }
  
  private convertSparkToBitcoinAddress(sparkAddress: string): string | null {
    try {
      // Check if this is a Spark address (starts with 'sp')
      if (!sparkAddress.startsWith('sp')) {
        return null;
      }
      
      // For now, we'll use a simplified approach:
      // Replace 'sp' prefix with 'bc' for Bitcoin mainnet
      // This is a temporary solution until we can properly handle bech32m
      // Note: This assumes the Spark address uses the same encoding as Bitcoin Taproot addresses
      const bitcoinAddress = 'bc' + sparkAddress.substring(2);
      
      // Validate that this creates a potentially valid Bitcoin address
      if (!bitcoinAddress.startsWith('bc1')) {
        return null;
      }
      
      return bitcoinAddress;
    } catch (error) {
      this.logger.error(`Failed to convert Spark address: ${error}`);
      return null;
    }
  }
}