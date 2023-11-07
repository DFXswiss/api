import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { OptimismClient } from './optimism-client';

@Injectable()
export class OptimismService extends EvmService {
  constructor(http: HttpService) {
    const {
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletPrivateKey,
      optimismChainId,
      optimismAlchemyNetwork,
    } = GetConfig().blockchain.optimism;

    super(
      http,
      optimismScanApiUrl,
      optimismScanApiKey,
      optimismGatewayUrl,
      optimismApiKey,
      optimismWalletPrivateKey,
      optimismChainId,
      OptimismClient,
      optimismAlchemyNetwork,
    );
  }
}
