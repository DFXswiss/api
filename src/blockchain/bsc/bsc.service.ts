import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BSCClient } from './bsc-client';
import { EVMService } from '../shared/evm/evm.service';

@Injectable()
export class BSCService extends EVMService {
  constructor() {
    const { bscGatewayUrl, bscWalletAddress, bscWalletPrivateKey } = GetConfig().blockchain.bsc;

    super(bscGatewayUrl, '', bscWalletAddress, bscWalletPrivateKey, BSCClient);
  }
}
