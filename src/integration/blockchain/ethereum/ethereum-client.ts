import { ChainId } from '@uniswap/smart-order-router';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    chainId: ChainId,
    swapContractAddress: string,
    gatewayUrl: string,
    privateKey: string,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, swapContractAddress, gatewayUrl, privateKey);
  }
}
