import { Config } from 'src/config/config';
import { encode } from 'lnurl';

export class LightningHelper {
  static createLnUrlP(id: string): string {
    const url = `${Config.url}/lnurlp/${id}`;
    return encode(url).toUpperCase();
  }
}
