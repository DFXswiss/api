import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { ArbitrumClient } from './arbitrum-client';

@Injectable()
export class ArbitrumService extends EvmService {
  constructor(http: HttpService) {
    const { arbitrumGatewayUrl, arbitrumApiKey, arbitrumWalletPrivateKey, arbitrumChainId } =
      GetConfig().blockchain.arbitrum;

    super(http, arbitrumGatewayUrl, arbitrumApiKey, arbitrumWalletPrivateKey, arbitrumChainId, ArbitrumClient);
  }
}
