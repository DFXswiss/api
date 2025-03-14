import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { BscClient } from './bsc-client';

@Injectable()
export class BscService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const { bscGatewayUrl, bscApiKey, bscWalletPrivateKey, bscChainId, swapContractAddress, quoteContractAddress } =
      GetConfig().blockchain.bsc;

    super(BscClient, {
      http,
      alchemyService,
      gatewayUrl: bscGatewayUrl,
      apiKey: bscApiKey,
      walletPrivateKey: bscWalletPrivateKey,
      chainId: bscChainId,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
