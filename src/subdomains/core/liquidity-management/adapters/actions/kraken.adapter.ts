import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class KrakenAdapter extends CcxtExchangeAdapter {
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

  constructor(krakenService: KrakenService, dexService: DexService) {
    super(LiquidityManagementSystem.KRAKEN, krakenService, dexService);
  }

  protected mapBlockchainToCcxtNetwork(blockchain: Blockchain): string {
    return this.ccxtNetworks[blockchain];
  }
}
