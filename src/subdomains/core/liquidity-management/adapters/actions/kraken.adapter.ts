import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';

@Injectable()
export class KrakenAdapter extends CcxtExchangeAdapter {
  private ccxtNetworks: { [b in Blockchain]: string } = {
    Arbitrum: 'arbitrum',
    BinanceSmartChain: 'bsc',
    Bitcoin: 'bitcoin',
    Lightning: undefined,
    Cardano: 'cardano',
    DeFiChain: 'defichain',
    Ethereum: 'ethereum',
    Optimism: 'optimism',
    Polygon: 'polygon',
  };

  constructor(
    krakenService: KrakenService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.KRAKEN, krakenService, dexService, liquidityOrderRepo);
  }

  protected mapBlockchainToCcxtNetwork(blockchain: Blockchain): string {
    return this.ccxtNetworks[blockchain];
  }
}
