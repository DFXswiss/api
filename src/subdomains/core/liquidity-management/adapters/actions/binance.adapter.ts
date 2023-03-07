import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CcxtExchangeAdapter {
  private ccxtNetworks: { [b in Blockchain]: string } = {
    Arbitrum: 'arbitrum',
    BinanceSmartChain: 'bsc',
    Bitcoin: 'bitcoin',
    Cardano: 'cardano',
    DeFiChain: 'defichain',
    Ethereum: 'ethereum',
    Optimism: 'optimism',
    Polygon: 'polygon',
  };

  constructor(binanceService: BinanceService, dexService: DexService) {
    super(LiquidityManagementSystem.BINANCE, binanceService, dexService);
  }

  protected mapBlockchainToCcxtNetwork(blockchain: Blockchain): string {
    return this.ccxtNetworks[blockchain];
  }
}
