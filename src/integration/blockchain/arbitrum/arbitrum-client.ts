import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class ArbitrumClient extends EvmClient {
  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    dfxAddress: string,
    swapContractAddress: string,
    swapTokenAddress: string,
  ) {
    super(http, scanApiUrl, scanApiKey, gatewayUrl, privateKey, dfxAddress, swapContractAddress, swapTokenAddress);
  }

  /**
   * @note
   * requires UniswapV3 implementation or alternative
   */
  async nativeCryptoTestSwap(_nativeCryptoAmount: number, _targetToken: Asset): Promise<number> {
    throw new Error('nativeCryptoTestSwap is not implemented for Arbitrum blockchain');
  }
}
