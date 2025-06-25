import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { OptimismClient } from './optimism-client';

@Injectable()
export class OptimismService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService, loggerFactory: LoggerFactory) {
    const {
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletPrivateKey,
      optimismChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.optimism;

    super(OptimismClient, {
      http,
      alchemyService,
      gatewayUrl: optimismGatewayUrl,
      apiKey: optimismApiKey,
      walletPrivateKey: optimismWalletPrivateKey,
      chainId: optimismChainId,
      loggerFactory,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
