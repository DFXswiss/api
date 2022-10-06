import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { EthereumClient } from './ethereum-client';
import { EvmService } from '../shared/evm/evm.service';

@Injectable()
export class EthereumService extends EvmService {
  constructor() {
    const { ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey, uniswapV2Router02Address } =
      GetConfig().blockchain.ethereum;

    super(ethGatewayUrl, ethApiKey, ethWalletAddress, ethWalletPrivateKey, uniswapV2Router02Address, EthereumClient);
  }
}
