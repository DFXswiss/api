import { EvmClient } from '../shared/evm/evm-client';

export class BscClient extends EvmClient {
  constructor(
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    super(gatewayUrl, privateKey, dfxAddress, swapContractAddress, swapTokenAddress);
  }
}
