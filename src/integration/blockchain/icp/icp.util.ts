import { Principal } from '@dfinity/principal';
import { createHash } from 'crypto';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { InternetComputerWallet } from './icp-wallet';

export class InternetComputerUtil {
  static createWallet(walletAccount: WalletAccount): InternetComputerWallet {
    return InternetComputerWallet.fromSeed(walletAccount.seed, walletAccount.index);
  }

  static fromSmallestUnit(value: bigint, decimals = 8): number {
    return Number(value) / Math.pow(10, decimals);
  }

  static toSmallestUnit(amount: number, decimals = 8): bigint {
    return BigInt(Math.round(amount * Math.pow(10, decimals)));
  }

  // Canonicalize an ICP txId to a single form per underlying block, so replay-guard string
  // equality is not defeated by Number-coerced aliases (`"42"` vs `"042"` vs `"+42"` vs `"4.2e1"`
  // all resolve to the same native block; `canA:42` vs `canA:042` to the same ICRC-3 block).
  // Formats:
  //   - Rosetta 64-hex hash: lowercased.
  //   - ICRC-3 `canisterId:blockIndex`: block-index re-serialized via Number(...) if numeric.
  //   - Native block-index: re-serialized via Number(...) if numeric.
  // Non-numeric / unknown-shape txIds are returned untouched (the downstream lookup will fail).
  static canonicalizeTxId(txId: string): string {
    if (/^[a-f0-9]{64}$/i.test(txId)) return txId.toLowerCase();

    const parts = txId.split(':');
    if (parts.length === 2) {
      const [canisterId, indexStr] = parts;
      const index = Number(indexStr);
      return Number.isFinite(index) ? `${canisterId}:${index}` : txId;
    }

    const index = Number(txId);
    return Number.isFinite(index) && txId.trim().length > 0 ? String(index) : txId;
  }

  static accountIdentifier(address: string, subaccount?: Uint8Array): string {
    const principal = Principal.fromText(address);
    const padding = Buffer.from('\x0Aaccount-id');
    const sub = subaccount ?? new Uint8Array(32);
    const hash = createHash('sha224').update(padding).update(principal.toUint8Array()).update(sub).digest();
    const crc = InternetComputerUtil.crc32(hash);
    return Buffer.concat([crc, hash]).toString('hex');
  }

  private static crc32(data: Buffer): Buffer {
    let crc = 0xffffffff;

    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }

    const buf = Buffer.alloc(4);
    buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);

    return buf;
  }
}
