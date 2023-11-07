import { ChainId } from '@uniswap/sdk-core';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    chainId: ChainId,
    alchemyNetwork: string,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, gatewayUrl, privateKey, alchemyNetwork);
  }
}
