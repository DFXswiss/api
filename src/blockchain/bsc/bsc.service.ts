import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { BSCClient } from './bsc-client';
import { EVMService } from '../shared/evm/evm.service';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class BSCService extends EVMService {
  // TODO - fix DI issue
  constructor(httpService: HttpService) {
    const { bscGatewayUrl, bscWalletAddress, bscWalletPrivateKey } = Config.blockchain.bsc;

    super(bscGatewayUrl, '', bscWalletAddress, bscWalletPrivateKey, BSCClient);
  }
}
