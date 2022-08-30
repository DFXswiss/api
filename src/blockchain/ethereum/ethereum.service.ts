import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { Config } from 'src/config/config';
import { EthereumClient } from './ethereum-client';

@Injectable()
export class EthereumService {
  readonly #clients: Map<'default', EthereumClient> = new Map();

  // TODO - fix dependency injection, without SharedModule injection - initialized before Config
  constructor(private readonly http: HttpService) {
    this.initClient();
  }

  getClient(): EthereumClient {
    return this.#clients.get('default');
  }

  // *** INIT METHODS *** //

  private initClient(): void {
    const { ethGatewayUrl, ethWalletPrivateKey, ethWalletAddress } = Config.blockchain.ethereum;

    this.#clients.set('default', new EthereumClient(ethGatewayUrl, ethWalletPrivateKey, ethWalletAddress));
  }
}
