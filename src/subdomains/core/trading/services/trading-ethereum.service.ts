import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradingRegistryService } from './trading-registry.service';
import { TradingUniswapService } from './trading-uniswap.service';

@Injectable()
export class TradingEthereumService extends TradingUniswapService implements OnModuleInit {
  blockchain: Blockchain = Blockchain.ETHEREUM;

  constructor(private readonly tradingRegistry: TradingRegistryService) {
    const { ethGatewayUrl, ethApiKey, ethChainId } = GetConfig().blockchain.ethereum;
    const { zchfUsdtPool } = GetConfig().uniswap.ethereum;

    super(ethGatewayUrl, ethApiKey, ethChainId, zchfUsdtPool);
  }

  onModuleInit() {
    this.tradingRegistry.register(this);
  }
}
