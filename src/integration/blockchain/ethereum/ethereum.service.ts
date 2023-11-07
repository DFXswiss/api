import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { EvmService } from '../shared/evm/evm.service';
import { EthereumClient } from './ethereum-client';

@Injectable()
export class EthereumService extends EvmService {
  constructor(http: HttpService) {
    const {
      ethScanApiUrl,
      ethScanApiKey,
      ethGatewayUrl,
      ethApiKey,
      ethWalletPrivateKey,
      ethChainId,
      ethAlchemyNetwork,
    } = GetConfig().blockchain.ethereum;

    super(
      http,
      ethScanApiUrl,
      ethScanApiKey,
      ethGatewayUrl,
      ethApiKey,
      ethWalletPrivateKey,
      ethChainId,
      EthereumClient,
      ethAlchemyNetwork,
    );
  }
}
