import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import { BigNumberish } from 'ethers';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
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

  // the native lamports scale (9) a coin is ALWAYS broadcast at — the same expression toLamportAmount uses by default,
  // so a captured value can never diverge from the sent amount.
  static readonly coinDecimals = new BigNumber(1 / LAMPORTS_PER_SOL).decimalPlaces();

  // §2.3 native-first exactness (issue #4287 stage 3): the EXACT integer base units of a DFX-computed Solana amount at
  // the resolution it is BROADCAST — the SAME scaling the client uses to build the transfer (toLamportAmount →
  // toWeiAmount), so the stored integer equals what actually moves on-chain down to the lamport. The Solana analogue of
  // EvmUtil.toBroadcastBaseUnits: a native COIN is ALWAYS broadcast at the lamports scale (9) via toLamportAmount(amount)
  // with no decimals arg (createNativeCoinTransaction), regardless of the asset's configured decimals — so a coin is
  // captured ONLY when its configured decimals match that scale and fails open otherwise (never storing a value
  // diverging from the sent amount); a TOKEN is broadcast via toLamportAmount(amount, token.decimals) = asset.decimals.
  // For a >8-dp asset (a 9-dp SOL coin) this DIFFERS from the <=8-dp float derivation; the ledger books it verbatim on
  // the withdrawal wallet leg. Additive / fail-open: unknown/incompatible decimals or any conversion error -> null.
  static toBroadcastBaseUnits(amount: number, asset: Asset | null | undefined): bigint | null {
    const decimals = asset?.decimals;
    if (asset == null || decimals == null) return null;
    if (asset.type === AssetType.COIN && decimals !== SolanaUtil.coinDecimals) return null;
    try {
      return BigInt(EvmUtil.toWeiAmount(amount, decimals).toString());
    } catch {
      return null;
    }
  }
}
