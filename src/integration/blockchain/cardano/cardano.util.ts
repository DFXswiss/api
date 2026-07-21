import { BigNumberish } from 'ethers';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { EvmUtil } from '../shared/evm/evm.util';
import { CardanoWallet } from './cardano-wallet';

export class CardanoUtil {
  static createWallet({ seed, index }: WalletAccount): CardanoWallet {
    return CardanoWallet.createFromMnemonic(seed, 0, index);
  }

  // the native lovelace scale (6) — 10^6 lovelace = 1 ADA — the fixed resolution a Cardano tx fee is denominated at;
  // used to guard the exact fee-lovelace capture (only book verbatim when the ADA fee asset is configured at this scale).
  static readonly coinDecimals = 6;

  static fromLovelaceAmount(amountLovelaceLike: BigNumberish, decimals?: number): number {
    return EvmUtil.fromWeiAmount(amountLovelaceLike, decimals ?? 6);
  }

  static toLovelaceAmount(amountAdaLike: number, decimals?: number): number {
    return EvmUtil.toWeiAmount(amountAdaLike, decimals ?? 6).toNumber();
  }
}
