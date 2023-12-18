import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { EthereumClient } from './ethereum-client';

@Injectable()
export class EthereumService extends EvmService {
  constructor(http: HttpService) {
    const { ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } = GetConfig().blockchain.ethereum;

    super(http, ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId, EthereumClient);
  }
}
