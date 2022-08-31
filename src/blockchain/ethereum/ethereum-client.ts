import { EthereumBaseClient } from './ethereum-base-client';

export class EthereumClient extends EthereumBaseClient {
  constructor(gatewayUrl: string, privateKey: string, address: string) {
    super(gatewayUrl, privateKey, address);
  }
}
