import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { BscClient } from './bsc-client';

@Injectable()
export class BscService extends EvmService {
  constructor(http: HttpService) {
    const { bscScanApiUrl, bscScanApiKey, bscGatewayUrl, bscWalletPrivateKey, bscChainId } = GetConfig().blockchain.bsc;

    super(http, bscScanApiUrl, bscScanApiKey, bscGatewayUrl, '', bscWalletPrivateKey, bscChainId, BscClient);
  }
}
