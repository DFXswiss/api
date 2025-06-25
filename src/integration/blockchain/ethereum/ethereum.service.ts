import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { EthereumClient } from './ethereum-client';

@Injectable()
export class EthereumService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService, loggerFactory: LoggerFactory) {
    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId, swapContractAddress, quoteContractAddress } =
      GetConfig().blockchain.ethereum;

    super(EthereumClient, {
      http,
      alchemyService,
      gatewayUrl: ethGatewayUrl,
      apiKey: ethApiKey,
      walletPrivateKey: ethWalletPrivateKey,
      chainId: ethChainId,
      loggerFactory,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
