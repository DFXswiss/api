import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { Config } from 'src/config/config';
import { BNBClient } from './bnb-client';

@Injectable()
export class BNBService {
  readonly #clients: Map<'default', BNBClient> = new Map();

  // TODO - fix dependency injection, without SharedModule injection - initialized before Config
  constructor(private readonly http: HttpService) {
    this.initClient();
  }

  getClient(): BNBClient {
    return this.#clients.get('default');
  }

  // *** INIT METHODS *** //

  private initClient(): void {
    const { bnbGatewayUrl, bnbApiKey, bnbWalletPrivateKey, bnbWalletAddress } = Config.blockchain.bnb;

    this.#clients.set('default', new BNBClient(`${bnbGatewayUrl}/${bnbApiKey}`, bnbWalletPrivateKey, bnbWalletAddress));
  }
}
