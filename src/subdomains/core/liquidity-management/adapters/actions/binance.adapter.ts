import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CcxtExchangeAdapter {
  private ccxtNetworks: { [b in Blockchain]: string } = {
    Arbitrum: 'ARBITRUM',
    BinanceSmartChain: 'BSC',
    Bitcoin: 'BTC',
    Lightning: undefined,
    Monero: 'XMR',
    Cardano: undefined,
    DeFiChain: undefined,
    Ethereum: 'ETH',
    Optimism: 'OPTIMISM',
    Polygon: 'MATIC',
    Base: 'BASE',
  };

  constructor(
    binanceService: BinanceService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.BINANCE, binanceService, dexService, liquidityOrderRepo);
  }

  protected mapBlockchainToCcxtNetwork(blockchain: Blockchain): string {
    return this.ccxtNetworks[blockchain];
  }
}
