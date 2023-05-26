import { Config } from 'src/config/config';
import { encode } from 'lnurl';

export class LightningHelper {
  static get lnUrlPDfxApiBasePath(): string {
    return `${Config.url}/lnurlp`;
  }

  static get lnUrlPCallbackDfxApiBasePath(): string {
    return `${Config.url}/lnurlp/cb`;
  }

  static get lnUrlPLnBitsBasePath(): string {
    return `${Config.blockchain.lightning.lnbits.lnUrlPUrl}`;
  }

  static get lnUrlPCallbackLnBitsBasePath(): string {
    return `${Config.blockchain.lightning.lnbits.lnUrlPApiUrl}/lnurl/cb`;
  }

  /**
   * Create a encoded LNURLp Link with the HTTPS Address of our DFX API
   * and the ID of the LNbits Server
   */
  static createEncodedLnUrlP(id: string): string {
    const url = `${this.lnUrlPDfxApiBasePath}/${id}`;
    return encode(url).toUpperCase();
  }
}
