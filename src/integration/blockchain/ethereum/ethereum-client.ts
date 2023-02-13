import { HttpService } from 'src/shared/services/http.service';
import { EvmClient } from '../shared/evm/evm-client';

export class EthereumClient extends EvmClient {
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
}
