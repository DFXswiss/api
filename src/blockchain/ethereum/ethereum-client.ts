import { EvmClient } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
  constructor(gatewayUrl: string, privateKey: string, dfxAddress: string, swapContractAddress: string) {
    super(gatewayUrl, privateKey, dfxAddress, swapContractAddress);
  }
}
