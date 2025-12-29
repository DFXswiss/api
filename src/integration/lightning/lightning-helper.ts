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
    return Util.round(btcAmount * LightningHelper.SAT_BTC_FACTOR, 3);
  }

  static satToMsat(satAmount: number): number {
    return Util.round(satAmount * LightningHelper.SAT_MSAT_FACTOR, 0);
  }

  static btcToMsat(btcAmount: number): number {
    return Util.round(LightningHelper.satToMsat(LightningHelper.btcToSat(btcAmount)), 0);
  }

  static msatToSat(msatAmount: number): number {
    return Util.round(msatAmount / LightningHelper.SAT_MSAT_FACTOR, 3);
  }

  static satToBtc(satAmount: number): number {
    return Util.round(satAmount / LightningHelper.SAT_BTC_FACTOR, 12);
  }

  static msatToBtc(msatAmount: number): number {
    return Util.round(LightningHelper.satToBtc(LightningHelper.msatToSat(msatAmount)), 12);
  }

  // --- ADDRESSES --- //
  static addressToLnurlp(address: string): string {
    const [id, domain] = address.split('@');

    const url = `https://${domain}/.well-known/lnurlp/${id}`;
    return LightningHelper.encodeLnurl(url);
  }

  static getAddressType(address: string): LightningAddressType {
    for (const addressType of Object.values(LightningAddressType)) {
      if (address.startsWith(addressType)) {
        return addressType;
      }
    }

    throw new Error(`Cannot detect Lightning Address Type of address ${address}`);
  }

  // --- LNURLp --- //
  static createEncodedLnurlp(id: string): string {
    // create an encoded LNURLp with the HTTPS address of DFX API and the LNbits ID
    return this.encodeLnurl(this.createLnurlp(id));
  }

  static createLnurlp(id: string): string {
    return `${Config.url()}/lnurlp/${id}`;
  }

  static createLnurlpCallbackUrl(id: string): string {
    return `${Config.url()}/lnurlp/cb/${id}`;
  }

  // --- LNURLw --- //
  static createEncodedLnurlw(id: string): string {
    // create an encoded LNURLw with the HTTPS address of DFX API and the LNbits ID
    const url = `${Config.url()}/lnurlw/${id}`;
    return this.encodeLnurl(url);
  }

  static createLnurlwCallbackUrl(id: string): string {
    return `${Config.url()}/lnurlw/cb/${id}`;
  }

  static createLnurldCallbackUrl(id: string, variable: string): string {
    return `${Config.url()}/lnurld/cb/${id}/${variable}`;
  }

  // --- LNURL --- //
  static encodeLnurl(str: string): string {
    return lnurlEncode(str).toUpperCase();
  }

  static decodeLnurl(lnurl: string): string {
    return lnurlDecode(lnurl);
  }

  static createLnurlMetadata(memo: string): string {
    return `[["text/plain", "${memo}"]]`;
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

  static getPaymentHashOfInvoice(invoice: string): string {
    const decodedInvoice = bolt11Decode(invoice);

    const paymentHashTag = decodedInvoice.tags.find((t) => t.tagName === 'payment_hash');
    return (paymentHashTag?.data as string) ?? '';
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
