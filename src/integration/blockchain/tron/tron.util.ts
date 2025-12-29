import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as bs58check from 'bs58check';
import { BigNumberish } from 'ethers';
import { Util } from 'src/shared/utils/util';
import { TronWeb } from 'tronweb';
import { WalletAccount } from '../shared/evm/domain/wallet-account';
import { EvmUtil } from '../shared/evm/evm.util';
import { tronDefaultPath, TronWallet } from './tron-wallet';

export class TronUtil {
  static createWallet({ seed, index }: WalletAccount): TronWallet {
    const hdKey = HDKey.fromMasterSeed(mnemonicToSeedSync(seed, ''));
    const path = this.getPathFor(index);
    const privateKey = hdKey.derive(path).privateKey;

    return TronWallet.createWithPrivateKey(Util.uint8ToString(privateKey, 'hex'));
  }

  private static getPathFor(index: number): string {
    const components = tronDefaultPath.split('/');
    components[components.length - 1] = `${index.toString()}'`;
    return components.join('/');
  }

  static convertToVisibleAddress(hexAddress: string): string {
    return TronWeb.address.fromHex(hexAddress);
  }

  static convertToHexAddress(visibleAddress: string): string {
    return TronWeb.address.toHex(visibleAddress);
  }

  static convertToEvmAddress(tronAddress: string): string {
    const decodedTronAddress = bs58check.default.decode(tronAddress);
    if (decodedTronAddress[0] !== 0x41) throw new Error(`Invalid tron address ${tronAddress}`);

    return '0x' + Util.uint8ToString(decodedTronAddress.slice(1), 'hex');
  }

  static convertToTronAddress(evmAddress: string): string {
    const hex = evmAddress.replace(/^0x/, '');
    if (hex.length !== 40) throw new Error(`Invalid evm address ${evmAddress}`);

    const buffer = Buffer.from('41' + hex, 'hex');
    return bs58check.default.encode(buffer);
  }

  static fromSunAmount(amountSunLike: BigNumberish, decimals?: number): number {
    return EvmUtil.fromWeiAmount(amountSunLike, decimals ?? 6);
  }

  static toSunAmount(amountTrxLike: number, decimals?: number): number {
    return EvmUtil.toWeiAmount(amountTrxLike, decimals ?? 6).toNumber();
  }
}
