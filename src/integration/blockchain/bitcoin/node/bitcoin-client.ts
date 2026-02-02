import { Config, GetConfig } from 'src/config/config';
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
    return Config.blockchain.default.btcOutput.address;
  }
}
