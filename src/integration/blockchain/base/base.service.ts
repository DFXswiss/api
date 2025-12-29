import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { BaseClient } from './base-client';

@Injectable()
export class BaseService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const {
      baseGatewayUrl,
      baseApiKey,
      baseWalletPrivateKey,
      baseChainId,
      swapContractAddress,
      swapFactoryAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.base;

    super(BaseClient, {
      http,
      alchemyService,
      gatewayUrl: baseGatewayUrl,
      apiKey: baseApiKey,
      walletPrivateKey: baseWalletPrivateKey,
      chainId: baseChainId,
      swapContractAddress,
      swapFactoryAddress,
      quoteContractAddress,
    });
  }
}
