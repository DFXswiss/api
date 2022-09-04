import { EVMClient } from './evm-client';

export class EVMService<T extends EVMClient> {
  readonly #client: T;

  constructor(gatewayUrl: string, apiKey: string, walletAddress: string, walletPrivateKey: string, client: Function extends T) {
    this.#client = new client()
    this.initClient();
  }

  getClient(): T {
    return this.#client;
  }

  // *** INIT METHODS *** //

  private initClient(): void {
    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethWalletAddress } = Config.blockchain.ethereum;

    this.#clients.set(
      'default',
      new EthereumClient(`${ethGatewayUrl}/${ethApiKey}`, ethWalletPrivateKey, ethWalletAddress),
    );
  }
}
