import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { Config } from 'src/config/config';
import { BSCClient } from './bsc-client';

@Injectable()
export class BSCService {
  readonly #clients: Map<'default', BSCClient> = new Map();

  // TODO - fix dependency injection, without SharedModule injection - initialized before Config
  constructor(private readonly http: HttpService) {
    this.initClient();
  }

  getClient(): BSCClient {
    return this.#clients.get('default');
  }

  // *** INIT METHODS *** //

  private initClient(): void {
    const { bscGatewayUrl, bscApiKey, bscWalletPrivateKey, bscWalletAddress } = Config.blockchain.bsc;

    this.#clients.set('default', new BSCClient(`${bscGatewayUrl}/${bscApiKey}`, bscWalletPrivateKey, bscWalletAddress));
  }
}
