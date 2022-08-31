import { EthereumBaseClient } from '../ethereum/ethereum-base-client';

export class BSCClient extends EthereumBaseClient {
  constructor(gatewayUrl: string, privateKey: string, address: string) {
    super(gatewayUrl, privateKey, address);
  }
}
