import { EvmClient } from '../shared/evm/evm-client';

export class BscClient extends EvmClient {
  constructor(gatewayUrl: string, privateKey: string, address: string) {
    super(gatewayUrl, privateKey, address);
  }
}
