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
