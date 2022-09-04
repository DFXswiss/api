import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { EthereumClient } from './ethereum-client';
import { EVMService } from '../shared/evm/evm.service';

@Injectable()
export class EthereumService extends EVMService<EthereumClient> {
  constructor() {
    const { ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey } = Config.blockchain.ethereum;

    super(ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey, EthereumClient);
  }
}
