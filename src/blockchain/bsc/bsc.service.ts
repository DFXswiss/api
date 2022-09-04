import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BSCClient } from './bsc-client';
import { EVMService } from '../shared/evm/evm.service';

@Injectable()
export class BSCService extends EVMService {
  constructor() {
    const { bscGatewayUrl, bscApiKey, bscWalletAddress, bscWalletPrivateKey } = Config.blockchain.bsc;

    super(bscGatewayUrl, bscApiKey, bscWalletAddress, bscWalletPrivateKey, BSCClient);
  }
}
