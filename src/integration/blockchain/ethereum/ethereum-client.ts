import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';
import { ChainId } from '@uniswap/smart-order-router';

export class EthereumClient extends EvmClient {
  constructor(
    http: HttpService,
    scanApiUrl: string,
    scanApiKey: string,
    gatewayUrl: string,
    privateKey: string,
    chainId: ChainId,
  ) {
    super(http, scanApiUrl, scanApiKey, chainId, gatewayUrl, privateKey);
  }
}
