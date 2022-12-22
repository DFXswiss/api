import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { ArbitrumClient } from './arbitrum-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class ArbitrumService extends EvmService {
  constructor() {
    const {
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletAddress,
      arbitrumWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
    } = GetConfig().blockchain.arbitrum;

    super(
      arbitrumGatewayUrl,
      arbitrumApiKey,
      arbitrumWalletAddress,
      arbitrumWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
      ArbitrumClient,
    );
  }
}
