import { TronWeb } from 'tronweb';

export const tronDefaultPath = "m/44'/195'/0'/0/0";

export class TronWallet {
  static createWithMnemonic(mnemonic: string): TronWallet {
    const { privateKey, address } = TronWeb.fromMnemonic(mnemonic);
    return new TronWallet(privateKey.replace(/^0x/, ''), address);
  }

  static createWithPrivateKey(privateKey: string): TronWallet {
    const address = TronWeb.address.fromPrivateKey(privateKey);
    if (!address) throw new Error('Cannot create address of private key');

    return new TronWallet(privateKey, address);
  }

  constructor(
    readonly privateKey: string,
    readonly address: string,
  ) {}
}
