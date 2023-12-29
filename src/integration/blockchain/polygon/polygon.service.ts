import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { PolygonClient } from './polygon-client';

@Injectable()
export class PolygonService extends EvmService implements OnModuleInit {
  constructor(http: HttpService, private readonly alchemyService: AlchemyService) {
    const { polygonGatewayUrl, polygonApiKey, polygonWalletPrivateKey, polygonChainId } =
      GetConfig().blockchain.polygon;

    super(http, polygonGatewayUrl, polygonApiKey, polygonWalletPrivateKey, polygonChainId, PolygonClient);
  }

  onModuleInit() {
    this.getDefaultClient().alchemyService = this.alchemyService;
  }
}
