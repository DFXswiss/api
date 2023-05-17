import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { ArbitrumClient } from './arbitrum-client';
import { EvmService } from '../shared/evm/evm.service';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class ArbitrumService extends EvmService {
  constructor(http: HttpService) {
    const {
      arbitrumScanApiUrl,
      arbitrumScanApiKey,
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletPrivateKey,
      arbitrumChainId,
    } = GetConfig().blockchain.arbitrum;

    super(
      http,
      arbitrumScanApiUrl,
      arbitrumScanApiKey,
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletPrivateKey,
      arbitrumChainId,
      ArbitrumClient,
    );
  }
}
