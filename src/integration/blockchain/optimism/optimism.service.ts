import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { OptimismClient } from './optimism-client';

@Injectable()
export class OptimismService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService, logger: DfxLoggerService) {
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
      logger,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
