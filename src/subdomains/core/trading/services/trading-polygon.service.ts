import { Injectable, OnModuleInit } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradingRegistryService } from './trading-registry.service';
import { TradingUniswapService } from './trading-uniswap.service';

@Injectable()
export class TradingPolygonService extends TradingUniswapService implements OnModuleInit {
  blockchain: Blockchain = Blockchain.POLYGON;

  constructor(private readonly tradingRegistry: TradingRegistryService) {
    const { polygonGatewayUrl, polygonApiKey, polygonChainId } = GetConfig().blockchain.polygon;
    const { zchfUsdtPool } = GetConfig().uniswap.polygon;
    super(polygonGatewayUrl, polygonApiKey, polygonChainId, zchfUsdtPool);
  }

  onModuleInit() {
    this.tradingRegistry.register(this);
  }
}
