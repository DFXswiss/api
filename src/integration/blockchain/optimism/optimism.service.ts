import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { OptimismClient } from './optimism-client';

@Injectable()
export class OptimismService extends EvmService implements OnModuleInit {
  constructor(http: HttpService, private readonly alchemyService: AlchemyService) {
    const { optimismGatewayUrl, optimismApiKey, optimismWalletPrivateKey, optimismChainId } =
      GetConfig().blockchain.optimism;

    super(http, optimismGatewayUrl, optimismApiKey, optimismWalletPrivateKey, optimismChainId, OptimismClient);
  }

  onModuleInit() {
    this.getDefaultClient().alchemyService = this.alchemyService;
  }
}
