import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { BscClient } from './bsc-client';

@Injectable()
export class BscService extends EvmService {
  constructor(http: HttpService) {
    const { bscGatewayUrl, bscWalletPrivateKey, bscChainId, bscScanApiUrl, bscScanApiKey, swapContractAddress } =
      GetConfig().blockchain.bsc;

    super(BscClient, {
      http,
      gatewayUrl: bscGatewayUrl,
      apiKey: '',
      walletPrivateKey: bscWalletPrivateKey,
      chainId: bscChainId,
      scanApiUrl: bscScanApiUrl,
      scanApiKey: bscScanApiKey,
      swapContractAddress,
    });
  }
}
