import { EVMClient } from '../shared/evm/evm-client';

export class EthereumClient extends EVMClient {
  constructor(gatewayUrl: string, privateKey: string, address: string) {
    super(gatewayUrl, privateKey, address);
  }
}
