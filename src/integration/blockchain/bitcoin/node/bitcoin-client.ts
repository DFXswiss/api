import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BitcoinBasedClient } from './bitcoin-based-client';
import { NodeClientConfig } from './node-client';

export class BitcoinClient extends BitcoinBasedClient {
  constructor(http: HttpService, url: string) {
    const defaultConfig = GetConfig().blockchain.default;

    const config: NodeClientConfig = {
      user: defaultConfig.user,
      password: defaultConfig.password,
      walletPassword: defaultConfig.walletPassword,
      allowUnconfirmedUtxos: defaultConfig.allowUnconfirmedUtxos,
    };

    super(http, url, config);
  }

  get walletAddress(): string {
    throw new Error('Bitcoin uses per-transaction change addresses — use getNewChangeAddress() instead');
  }

  protected async getChangeAddress(): Promise<string> {
    return this.createAddress('change', 'bech32');
  }
}
