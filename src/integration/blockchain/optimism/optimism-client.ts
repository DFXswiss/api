import { EvmClient } from '../shared/evm/evm-client';

export class OptimismClient extends EvmClient {
  constructor(
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    super(gatewayUrl, privateKey, dfxAddress, swapContractAddress, swapTokenAddress);
  }

  /**
   * @note
   * defaulting to 0 until solution for fetching Optimism tx fees is implemented
   */
  async getTxActualFee(_txHash: string): Promise<number> {
    return 0;
  }
}
