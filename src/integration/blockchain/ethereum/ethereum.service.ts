import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { EthereumClient } from './ethereum-client';
import { EvmService } from '../shared/evm/evm.service';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class EthereumService extends EvmService {
  constructor(http: HttpService) {
    const { ethScanApiUrl, ethScanApiKey, ethGatewayUrl, ethApiKey, ethWalletPrivateKey, ethChainId } =
      GetConfig().blockchain.ethereum;

    super(
      http,
      ethScanApiUrl,
      ethScanApiKey,
      ethGatewayUrl,
      ethApiKey,
      ethWalletPrivateKey,
      ethChainId,
      EthereumClient,
    );
  }
}
