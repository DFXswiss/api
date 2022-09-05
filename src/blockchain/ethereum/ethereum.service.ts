import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EthereumClient } from './ethereum-client';
import { EVMService } from '../shared/evm/evm.service';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class EthereumService extends EVMService {
  // TODO - fix DI issue
  constructor(httpService: HttpService) {
    const { ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey } = Config.blockchain.ethereum;

    super(ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey, EthereumClient);
  }
}
