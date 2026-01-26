import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { GoldskyService } from 'src/integration/goldsky/goldsky.service';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { CitreaClient } from './citrea-client';

@Injectable()
export class CitreaService extends EvmService {
  constructor(http: HttpService, goldskyService: GoldskyService) {
    const { citreaGatewayUrl, citreaApiKey, citreaWalletPrivateKey, citreaChainId } = GetConfig().blockchain.citrea;

    super(CitreaClient, {
      http,
      gatewayUrl: citreaGatewayUrl,
      apiKey: citreaApiKey,
      walletPrivateKey: citreaWalletPrivateKey,
      chainId: citreaChainId,
      goldskyService,
    });
  }
}
