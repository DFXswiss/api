import { Injectable } from '@nestjs/common';
import { ArkAddress, DefaultVtxo } from '@arkade-os/sdk';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { Bech32mService } from '../shared/bech32m/bech32m.service';
import { ArkClient, ArkTransaction } from './ark-client';

@Injectable()
export class ArkService extends Bech32mService {
  readonly defaultPrefix = 'ark';

  private readonly client: ArkClient;

  constructor() {
    super();
    this.client = new ArkClient();
  }

  getDefaultClient(): ArkClient {
    return this.client;
  }

  async verifySignature(message: string, address: string, signatureHex: string): Promise<boolean> {
    const baseResult = await super.verifySignature(message, address, signatureHex);
    if (baseResult) return true;

    try {
      const decoded = ArkAddress.decode(address);
      const messageHash = sha256(new TextEncoder().encode(message));
      const signatureBytes = Buffer.from(signatureHex, 'hex');

      for (let recovery = 0; recovery <= 3; recovery++) {
        try {
          const sig = secp256k1.Signature.fromBytes(signatureBytes, 'compact').addRecoveryBit(recovery);
          const xOnlyKey = sig.recoverPublicKey(messageHash).toBytes(true).slice(1);

          const vtxoScript = new DefaultVtxo.Script({
            pubKey: xOnlyKey,
            serverPubKey: decoded.serverPubKey,
          });

          if (Buffer.from(vtxoScript.tweakedPublicKey).equals(Buffer.from(decoded.vtxoTaprootKey))) {
            return true;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // not a valid ArkAddress format
    }

    return false;
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<ArkTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
