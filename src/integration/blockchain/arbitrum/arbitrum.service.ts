import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { ArbitrumClient } from './arbitrum-client';

@Injectable()
export class ArbitrumService extends EvmService implements OnModuleInit {
  constructor(http: HttpService, private readonly alchemyService: AlchemyService) {
    const { arbitrumGatewayUrl, arbitrumApiKey, arbitrumWalletPrivateKey, arbitrumChainId } =
      GetConfig().blockchain.arbitrum;

    super(http, arbitrumGatewayUrl, arbitrumApiKey, arbitrumWalletPrivateKey, arbitrumChainId, ArbitrumClient);
  }

  onModuleInit() {
    this.getDefaultClient().alchemyService = this.alchemyService;
  }
}
