import { Config, GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { BitcoinBasedClient } from '../bitcoin/node/bitcoin-based-client';
import { NodeClientConfig } from '../bitcoin/node/node-client';

export class BitcoinTestnet4Client extends BitcoinBasedClient {
  constructor(http: HttpService, url: string) {
    const testnet4Config = GetConfig().blockchain.bitcoinTestnet4;

    const config: NodeClientConfig = {
      user: testnet4Config.user,
      password: testnet4Config.password,
      walletPassword: testnet4Config.walletPassword,
      allowUnconfirmedUtxos: true,
    };

    super(http, url, config);
  }

  get walletAddress(): string {
    return Config.blockchain.bitcoinTestnet4.btcTestnet4Output.address;
  }
}
