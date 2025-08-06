import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { AlchemyService } from 'src/integration/alchemy/services/alchemy.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { CitreaTestnetClient } from './citrea-testnet-client';

@Injectable()
export class CitreaTestnetService extends EvmService {
  constructor(http: HttpService, alchemyService: AlchemyService) {
    const { citreaTestnetGatewayUrl, citreaTestnetApiKey, citreaTestnetWalletPrivateKey, citreaTestnetChainId } =
      GetConfig().blockchain.citreaTestnet;

    super(CitreaTestnetClient, {
      http,
      alchemyService,
      gatewayUrl: citreaTestnetGatewayUrl,
      apiKey: citreaTestnetApiKey,
      walletPrivateKey: citreaTestnetWalletPrivateKey,
      chainId: citreaTestnetChainId,
    });
  }
}