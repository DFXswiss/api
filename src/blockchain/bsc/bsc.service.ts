import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BscClient } from './bsc-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class BscService extends EvmService {
  constructor() {
    const { bscGatewayUrl, bscWalletAddress, bscWalletPrivateKey, pancakeRouterAddress } = GetConfig().blockchain.bsc;

    super(bscGatewayUrl, '', bscWalletAddress, bscWalletPrivateKey, pancakeRouterAddress, BscClient);
  }
}
