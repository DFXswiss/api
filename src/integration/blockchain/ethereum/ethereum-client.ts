import { ChainId } from '@uniswap/sdk-core';
import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
  constructor(http: HttpService, gatewayUrl: string, privateKey: string, chainId: ChainId) {
    super(http, gatewayUrl, privateKey, chainId);
  }
}
