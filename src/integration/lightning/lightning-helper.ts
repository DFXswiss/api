import { Config } from 'src/config/config';
import { encode } from 'lnurl';

export class LightningHelper {
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
    return encode(url).toUpperCase();
  }
}
