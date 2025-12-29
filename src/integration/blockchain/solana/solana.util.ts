import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { BigNumberish } from 'ethers';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { EvmUtil } from '../shared/evm/evm.util';
import { solanaDefaultPath, SolanaWallet } from './solana-wallet';

export class SolanaUtil {
  static createWallet({ seed, index }: WalletAccount): SolanaWallet {
    const hdKey = HDKey.fromMasterSeed(mnemonicToSeedSync(seed, ''));
    const path = this.getPathFor(index);

    const keypair = Keypair.fromSeed(hdKey.derive(path).privateKey);
    return new SolanaWallet(keypair);
  }

  private static getPathFor(index: number): string {
    const components = solanaDefaultPath.split('/');
    components[components.length - 1] = `${index.toString()}'`;
    return components.join('/');
  }

  static fromLamportAmount(amountLamportLike: BigNumberish, decimals?: number): number {
    const useDecimals = decimals ?? new BigNumber(1 / LAMPORTS_PER_SOL).decimalPlaces();
    return EvmUtil.fromWeiAmount(amountLamportLike, useDecimals);
  }

  static toLamportAmount(amountSolLike: number, decimals?: number): number {
    const useDecimals = decimals ?? new BigNumber(1 / LAMPORTS_PER_SOL).decimalPlaces();
    return EvmUtil.toWeiAmount(amountSolLike, useDecimals).toNumber();
  }
}
