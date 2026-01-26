import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BlockscoutService } from 'src/integration/blockchain/shared/blockscout/blockscout.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { CitreaTestnetClient } from './citrea-testnet-client';

@Injectable()
export class CitreaTestnetService extends EvmService {
  constructor(http: HttpService, blockscoutService: BlockscoutService) {
    const {
      citreaTestnetGatewayUrl,
      citreaTestnetApiKey,
      citreaTestnetWalletPrivateKey,
      citreaTestnetChainId,
      blockscoutApiUrl,
    } = GetConfig().blockchain.citreaTestnet;

    super(CitreaTestnetClient, {
      http,
      gatewayUrl: citreaTestnetGatewayUrl,
      apiKey: citreaTestnetApiKey,
      walletPrivateKey: citreaTestnetWalletPrivateKey,
      chainId: citreaTestnetChainId,
      blockscoutService,
      blockscoutApiUrl,
    });
  }
}
