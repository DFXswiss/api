import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { ArbitrumClient } from './arbitrum-client';

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
      arbitrumAlchemyNetwork,
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
      arbitrumAlchemyNetwork,
    );
  }
}
