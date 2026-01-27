import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BlockscoutService } from 'src/integration/blockchain/shared/blockscout/blockscout.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { CitreaClient } from './citrea-client';

@Injectable()
export class CitreaService extends EvmService {
  constructor(http: HttpService, blockscoutService: BlockscoutService) {
    const {
      citreaGatewayUrl,
      citreaApiKey,
      citreaWalletPrivateKey,
      citreaChainId,
      blockscoutApiUrl,
      swapContractAddress,
      swapFactoryAddress,
      quoteContractAddress,
      juiceSwapGatewayAddress,
    } = GetConfig().blockchain.citrea;

    super(CitreaClient, {
      http,
      gatewayUrl: citreaGatewayUrl,
      apiKey: citreaApiKey,
      walletPrivateKey: citreaWalletPrivateKey,
      chainId: citreaChainId,
      blockscoutService,
      blockscoutApiUrl,
      swapContractAddress,
      swapFactoryAddress,
      quoteContractAddress,
      juiceSwapGatewayAddress,
    });
  }
}
