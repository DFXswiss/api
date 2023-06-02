import { Config } from 'src/config/config';
import { encode as lnurlEncode, decode as lnurlDecode } from 'lnurl';
import { ecdsaRecover, ecdsaVerify } from 'secp256k1';
import { decode as zbase32Decode } from 'zbase32';
import { createHash } from 'crypto';
import { decode as bolt11Decode } from 'bolt11';
import { Util } from 'src/shared/utils/util';

export class LightningHelper {
  static MSG_SIGNATURE_PREFIX = 'Lightning Signed Message:';

  static get lnurlpDfxApiBasePath(): string {
    return `${Config.url}/lnurlp`;
  }

  static get lnurlpCallbackDfxApiBasePath(): string {
    return `${Config.url}/lnurlp/cb`;
  }

  static get lnurlpLnBitsBasePath(): string {
    return `${Config.blockchain.lightning.lnbits.lnurlpUrl}`;
  }

  static get lnurlpCallbackLnBitsBasePath(): string {
    return `${Config.blockchain.lightning.lnbits.lnurlpApiUrl}/lnurl/cb`;
  }

  /**
   * Create a encoded LNURLp Link with the HTTPS Address of our DFX API
   * and the ID of the LNbits Server
   */
  static createEncodedLnurlp(id: string): string {
    const url = `${this.lnurlpDfxApiBasePath}/${id}`;
    return lnurlEncode(url).toUpperCase();
  }

  /**
   * Get the URL of the given LNURLp
   */
  static decodeLnurlp(lnurlp: string): string {
    return lnurlDecode(lnurlp);
  }

  /**
   * Detect the public key of the given signature
   */
  static getPublicKeyOfSignature(message: string, signature: string): string {
    const messageHash = LightningHelper.doubleSha256(LightningHelper.MSG_SIGNATURE_PREFIX + message);
    const decodedSignature = zbase32Decode(signature);

    const recoverId = decodedSignature[0] - 31;
    const checkSignature = decodedSignature.subarray(1);

    const publicKey = ecdsaRecover(checkSignature, recoverId, messageHash);

    return Util.uint8ToString(publicKey, 'hex');
  }

  static verifySignature(message: string, signature: string, publicKey: string): boolean {
    const messageHash = LightningHelper.doubleSha256(LightningHelper.MSG_SIGNATURE_PREFIX + message);
    const decodedSignature = zbase32Decode(signature);

    const checkSignature = decodedSignature.subarray(1);

    return ecdsaVerify(checkSignature, messageHash, Util.stringToUint8(publicKey, 'hex'));
  }

  /**
   * Detect the public key of the given invoice
   */
  static getPublicKeyOfInvoice(invoice: string): string {
    const decodedInvoice = bolt11Decode(invoice);
    return decodedInvoice.payeeNodeKey;
  }

  /**
   * Helper Functions
   */
  private static doubleSha256(message: string) {
    return LightningHelper.sha256(LightningHelper.sha256(message));
  }

  private static sha256(message: string | Buffer): Buffer {
    return createHash('sha256').update(message).digest();
  }
}
