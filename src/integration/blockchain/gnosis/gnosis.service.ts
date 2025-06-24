import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { GnosisClient } from './gnosis-client';

@Injectable()
export class GnosisService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService, logger: DfxLoggerService) {
    const {
      gnosisGatewayUrl,
      gnosisApiKey,
      gnosisWalletPrivateKey,
      gnosisChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.gnosis;

    super(GnosisClient, {
      http,
      alchemyService,
      gatewayUrl: gnosisGatewayUrl,
      apiKey: gnosisApiKey,
      walletPrivateKey: gnosisWalletPrivateKey,
      chainId: gnosisChainId,
      logger,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
