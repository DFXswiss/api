import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { EthereumClient } from './ethereum-client';

@Injectable()
export class EthereumService extends EvmService implements OnModuleInit {
  constructor(http: HttpService, private readonly alchemyService: AlchemyService) {
    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;

    super(http, ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId, EthereumClient);
  }

  onModuleInit() {
    this.getDefaultClient().alchemyService = this.alchemyService;
  }
}
