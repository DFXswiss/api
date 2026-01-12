import { BigNumberish } from 'ethers';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { EvmUtil } from '../shared/evm/evm.util';
import { CardanoWallet } from './cardano-wallet';

export class CardanoUtil {
  static createWallet({ seed, index }: WalletAccount): CardanoWallet {
    return CardanoWallet.createFromMnemonic(seed, 0, index);
  }

  static fromLovelaceAmount(amountLovelaceLike: BigNumberish, decimals?: number): number {
    return EvmUtil.fromWeiAmount(amountLovelaceLike, decimals ?? 6);
  }

  static toLovelaceAmount(amountAdaLike: number, decimals?: number): number {
    return EvmUtil.toWeiAmount(amountAdaLike, decimals ?? 6).toNumber();
  }
}
