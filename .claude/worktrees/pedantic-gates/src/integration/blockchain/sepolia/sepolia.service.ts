import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { SepoliaClient } from './sepolia-client';

@Injectable()
export class SepoliaService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const {
      sepoliaGatewayUrl,
      sepoliaApiKey,
      sepoliaWalletPrivateKey,
      sepoliaChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.sepolia;

    super(SepoliaClient, {
      http,
      alchemyService,
      gatewayUrl: sepoliaGatewayUrl,
      apiKey: sepoliaApiKey,
      walletPrivateKey: sepoliaWalletPrivateKey,
      chainId: sepoliaChainId,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
