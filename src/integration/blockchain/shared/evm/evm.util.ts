import { ethers } from 'ethers';
import { defaultPath } from 'ethers/lib/utils';
import { WalletAccount } from './domain/wallet-account';

export class EvmUtil {
  static createWallet({ seed, index }: WalletAccount, provider?: ethers.providers.JsonRpcProvider): ethers.Wallet {
    const wallet = ethers.Wallet.fromMnemonic(seed, this.getPathFor(index));
    return provider ? wallet.connect(provider) : wallet;
  }

  private static getPathFor(accountIndex: number): string {
    const components = defaultPath.split('/');
    components[components.length - 1] = accountIndex.toString();
    return components.join('/');
  }
}
