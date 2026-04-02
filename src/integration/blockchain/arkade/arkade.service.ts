import { Injectable } from '@nestjs/common';
import { ArkAddress, DefaultVtxo, DelegateVtxo } from '@arkade-os/sdk';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { GetConfig } from 'src/config/config';
import { Bech32mService } from '../shared/bech32m/bech32m.service';
import { ArkadeClient, ArkadeTransaction } from './arkade-client';

type CsvTimelock = { value: bigint; type: 'seconds' | 'blocks' } | undefined;

@Injectable()
export class ArkadeService extends Bech32mService {
  readonly defaultPrefix = 'ark';

  private readonly client: ArkadeClient;
  private serverInfo: { exitDelay: bigint; delegatePubKeys: Uint8Array[] } | null | undefined;

  constructor() {
    super();
    this.client = new ArkadeClient();
  }

  getDefaultClient(): ArkadeClient {
    return this.client;
  }

  async verifySignature(message: string, address: string, signatureHex: string): Promise<boolean> {
    const baseResult = await super.verifySignature(message, address, signatureHex);
    if (baseResult) return true;

    try {
      const decoded = ArkAddress.decode(address);
      const messageHash = sha256(new TextEncoder().encode(message));
      const signatureBytes = Buffer.from(signatureHex, 'hex');
      const csvTimelocks = await this.getCsvTimelocks();
      const delegatePubKeys = await this.getDelegatePubKeys();

      for (const csvTimelock of csvTimelocks) {
        for (let recovery = 0; recovery <= 3; recovery++) {
          try {
            const sig = secp256k1.Signature.fromBytes(signatureBytes, 'compact').addRecoveryBit(recovery);
            const xOnlyKey = sig.recoverPublicKey(messageHash).toBytes(true).slice(1);

            const baseOpts = {
              pubKey: xOnlyKey,
              serverPubKey: decoded.serverPubKey,
              ...(csvTimelock && { csvTimelock }),
            };

            // Try DefaultVtxo (non-delegated address)
            if (this.tweakedKeyMatches(new DefaultVtxo.Script(baseOpts), decoded.vtxoTaprootKey)) return true;

            // Try DelegateVtxo for each known delegate pubkey
            for (const delegatePubKey of delegatePubKeys) {
              if (
                this.tweakedKeyMatches(new DelegateVtxo.Script({ ...baseOpts, delegatePubKey }), decoded.vtxoTaprootKey)
              )
                return true;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // not a valid ArkAddress format
    }

    return false;
  }

  private tweakedKeyMatches(vtxoScript: { tweakedPublicKey: Uint8Array }, target: Uint8Array): boolean {
    return Buffer.from(vtxoScript.tweakedPublicKey).equals(Buffer.from(target));
  }

  private async getCsvTimelocks(): Promise<CsvTimelock[]> {
    const timelocks: CsvTimelock[] = [undefined];

    const info = await this.getServerInfo();
    if (info) {
      timelocks.push({
        value: info.exitDelay,
        type: info.exitDelay < 512n ? 'blocks' : 'seconds',
      });
    }

    return timelocks;
  }

  private async getDelegatePubKeys(): Promise<Uint8Array[]> {
    const info = await this.getServerInfo();
    return info?.delegatePubKeys ?? [];
  }

  private async getServerInfo(): Promise<{ exitDelay: bigint; delegatePubKeys: Uint8Array[] } | null> {
    if (this.serverInfo !== undefined) return this.serverInfo;

    try {
      const { arkadeServerUrl } = GetConfig().blockchain.arkade;

      const infoRes = await fetch(`${arkadeServerUrl}/v1/info`);
      const info = await infoRes.json();
      const exitDelay = BigInt(info.unilateralExitDelay);

      // Fetch known delegate pubkeys
      const delegatePubKeys: Uint8Array[] = [];
      const delegatorUrls = ['https://delegate.arkade.money'];
      for (const url of delegatorUrls) {
        try {
          const res = await fetch(`${url}/v1/delegator/info`);
          const data = await res.json();
          if (data?.pubkey) delegatePubKeys.push(Buffer.from(data.pubkey, 'hex').subarray(1));
        } catch {
          // delegator unreachable
        }
      }

      this.serverInfo = { exitDelay, delegatePubKeys };
      return this.serverInfo;
    } catch {
      this.serverInfo = null;
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.client.isHealthy();
  }

  // --- TRANSACTION METHODS --- //

  async sendTransaction(to: string, amount: number): Promise<{ txid: string; fee: number }> {
    return this.client.sendTransaction(to, amount);
  }

  async getTransaction(txId: string): Promise<ArkadeTransaction> {
    return this.client.getTransaction(txId);
  }

  async getNativeFee(): Promise<number> {
    return this.client.getNativeFee();
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
