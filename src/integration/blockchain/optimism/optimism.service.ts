import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { OptimismClient } from './optimism-client';
import { EvmService } from '../shared/evm/evm.service';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class OptimismService extends EvmService {
  constructor(http: HttpService) {
    const {
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
    } = GetConfig().blockchain.optimism;

    super(
      http,
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
      OptimismClient,
    );
  }
}
