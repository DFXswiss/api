import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { OptimismClient } from './optimism-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class OptimismService extends EvmService {
  constructor() {
    const {
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletAddress,
      optimismWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
    } = GetConfig().blockchain.optimism;

    super(
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletAddress,
      optimismWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
      OptimismClient,
    );
  }
}
