import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { EthereumClient } from './ethereum-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class EthereumService extends EvmService {
  constructor() {
    const {
      ethScanApiUrl,
      ethScanApiKey,
      ethGatewayUrl,
      ethApiKey,
      ethWalletAddress,
      ethWalletPrivateKey,
      uniswapV2Router02Address,
      swapTokenAddress,
    } = GetConfig().blockchain.ethereum;

    super(
      ethScanApiUrl,
      ethScanApiKey,
      ethGatewayUrl,
      ethApiKey,
      ethWalletAddress,
      ethWalletPrivateKey,
      uniswapV2Router02Address,
      swapTokenAddress,
      EthereumClient,
    );
  }
}
