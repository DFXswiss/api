import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BscClient } from './bsc-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class BscService extends EvmService {
  constructor() {
    const {
      bscScanApiUrl,
      bscScanApiKey,
      bscGatewayUrl,
      bscWalletAddress,
      bscWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
    } = GetConfig().blockchain.bsc;

    super(
      bscScanApiUrl,
      bscScanApiKey,
      bscGatewayUrl,
      '',
      bscWalletAddress,
      bscWalletPrivateKey,
      pancakeRouterAddress,
      swapTokenAddress,
      BscClient,
    );
  }
}
