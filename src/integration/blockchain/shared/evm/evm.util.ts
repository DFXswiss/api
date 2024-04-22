import { FeeAmount } from '@uniswap/v3-sdk';
import BigNumber from 'bignumber.js';
import { BigNumberish, ethers, BigNumber as EthersNumber } from 'ethers';
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

  static fromWeiAmount(amountWeiLike: BigNumberish, decimals?: number): number {
    const amount =
      decimals != null ? ethers.utils.formatUnits(amountWeiLike, decimals) : ethers.utils.formatEther(amountWeiLike);

    return parseFloat(amount);
  }

  static toWeiAmount(amountEthLike: number, decimals?: number): EthersNumber {
    const amount = new BigNumber(amountEthLike).toFixed(decimals ?? 18);

    return decimals ? ethers.utils.parseUnits(amount, decimals) : ethers.utils.parseEther(amount);
  }

  static poolFeeFactor(amount: FeeAmount): number {
    return amount / 1000000;
  }
}
