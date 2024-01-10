import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { ArbitrumClient } from './arbitrum-client';

@Injectable()
export class ArbitrumService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const { arbitrumGatewayUrl, arbitrumApiKey, arbitrumWalletPrivateKey, arbitrumChainId } =
      GetConfig().blockchain.arbitrum;

    super(ArbitrumClient, {
      http,
      alchemyService,
      gatewayUrl: arbitrumGatewayUrl,
      apiKey: arbitrumApiKey,
      walletPrivateKey: arbitrumWalletPrivateKey,
      chainId: arbitrumChainId,
    });
  }
}
