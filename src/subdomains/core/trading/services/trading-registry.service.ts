import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { TradingUniswapService } from './trading-uniswap.service';

@Injectable()
export class TradingRegistryService {
  private registry: Map<Blockchain, TradingUniswapService>;

  constructor() {
    this.registry = new Map();
  }

  register(tradingService: TradingUniswapService) {
    this.registry.set(tradingService.blockchain, tradingService);
  }

  getService(blockchain: Blockchain): TradingUniswapService {
    const service = this.registry.get(blockchain);
    if (!service) throw new Error(`No market making service found for blockchain ${blockchain}`);

    return service;
  }
}
