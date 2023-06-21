import { decode as bolt11Decode } from 'bolt11';
import { createHash } from 'crypto';
import { decode as lnurlDecode, encode as lnurlEncode } from 'lnurl';
import { ecdsaRecover, ecdsaVerify } from 'secp256k1';
import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { decode as zbase32Decode } from 'zbase32';

export enum LightningAddressType {
  LN_URL = 'LNURL',
  LN_NID = 'LNNID',
  LND_HUB = 'LNDHUB',
}

export class LightningHelper {
  private static SAT_BTC_FACTOR: number = 10 ** 8;
  private static SAT_MSAT_FACTOR: number = 10 ** 3;

  private static MSG_SIGNATURE_PREFIX = 'Lightning Signed Message:';

  // --- CONVERT --- /
  static btcToSat(btcAmount: number): number {
    return btcAmount * LightningHelper.SAT_BTC_FACTOR;
  }

  static satToMsat(satAmount: number): number {
    return satAmount * LightningHelper.SAT_MSAT_FACTOR;
  }

  static btcToMsat(btcAmount: number): number {
    return LightningHelper.satToMsat(LightningHelper.btcToSat(btcAmount));
  }

  static msatToSat(msatAmount: number): number {
    return msatAmount / LightningHelper.SAT_MSAT_FACTOR;
  }

  static satToBtc(satAmount: number): number {
    return satAmount / LightningHelper.SAT_BTC_FACTOR;
  }

  static msatToBtc(msatAmount: number): number {
    return LightningHelper.satToBtc(LightningHelper.msatToSat(msatAmount));
  }

  // --- ADDRESSES --- //
  static addressToLnurlp(address: string): string {
    const [id, domain] = address.split('@');

    const url = `https://${domain}/.well-known/lnurlp/${id}`;
    return LightningHelper.encodeLnurlp(url);
  }

  static getAddressType(address: string): LightningAddressType {
    if (address.startsWith(LightningAddressType.LN_URL)) {
      return LightningAddressType.LN_URL;
    } else if (address.startsWith(LightningAddressType.LN_NID)) {
      return LightningAddressType.LN_NID;
    } else if (address.startsWith(LightningAddressType.LND_HUB)) {
      return LightningAddressType.LND_HUB;
    }

    throw new Error(`Cannot detect Lightning Address Type of address ${address}`);
  }

  // --- LNURLP --- //
  static createEncodedLnurlp(id: string): string {
    // create an encoded LNURLp with the HTTPS address of DFX API and the LNbits ID
    const url = `${Config.url}/lnurlp/${id}`;
    return this.encodeLnurlp(url);
  }

  static encodeLnurlp(str: string): string {
    return lnurlEncode(str).toUpperCase();
  }

  static decodeLnurlp(lnurlp: string): string {
    return lnurlDecode(lnurlp);
  }

  static createLnurlpCallbackUrl(id: string): string {
    return `${Config.url}/lnurlp/cb/${id}`;
  }

  // --- SIGNATURE VERIFICATION --- //
  static getPublicKeyOfSignature(message: string, signature: string): string {
    const messageHash = this.getMessageHash(message);

    const { checkSignature, recoverId } = this.decodeSignature(signature);

    const publicKey = ecdsaRecover(checkSignature, recoverId, messageHash);

    return Util.uint8ToString(publicKey, 'hex');
  }

  static verifySignature(message: string, signature: string, publicKey: string): boolean {
    const messageHash = this.getMessageHash(message);

    const { checkSignature } = this.decodeSignature(signature);

    return ecdsaVerify(checkSignature, messageHash, Util.stringToUint8(publicKey, 'hex'));
  }

  // --- INVOICE --- //
  static getPublicKeyOfInvoice(invoice: string): string {
    const decodedInvoice = bolt11Decode(invoice);
    return decodedInvoice.payeeNodeKey;
  }

  // --- HELPER FUNCTIONS --- //
  private static getMessageHash(message: string) {
    return this.sha256(this.sha256(this.MSG_SIGNATURE_PREFIX + message));
  }

  private static decodeSignature(signature: string): { checkSignature: Uint8Array; recoverId: number } {
    const decodedSignature = zbase32Decode(signature);

    return {
      checkSignature: decodedSignature.subarray(1),
      recoverId: decodedSignature[0] - 31,
    };
  }

  private static sha256(message: string | Buffer): Buffer {
    return createHash('sha256').update(message).digest();
  }
}
