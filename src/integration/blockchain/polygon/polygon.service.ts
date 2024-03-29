import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { PolygonClient } from './polygon-client';

@Injectable()
export class PolygonService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const {
      polygonGatewayUrl,
      polygonApiKey,
      polygonWalletPrivateKey,
      polygonChainId,
      swapContractAddress,
      quoteContractAddress,
    } = GetConfig().blockchain.polygon;

    super(PolygonClient, {
      http,
      alchemyService,
      gatewayUrl: polygonGatewayUrl,
      apiKey: polygonApiKey,
      walletPrivateKey: polygonWalletPrivateKey,
      chainId: polygonChainId,
      swapContractAddress,
      quoteContractAddress,
    });
  }
}
