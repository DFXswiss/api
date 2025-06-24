import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { ArbitrumClient } from './arbitrum-client';

@Injectable()
export class ArbitrumService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService, logger: DfxLoggerService) {
    const {
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletPrivateKey,
      arbitrumChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.arbitrum;

    super(ArbitrumClient, {
      http,
      alchemyService,
      gatewayUrl: arbitrumGatewayUrl,
      apiKey: arbitrumApiKey,
      walletPrivateKey: arbitrumWalletPrivateKey,
      chainId: arbitrumChainId,
      logger,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
