import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CcxtExchangeAdapter {
  constructor(
    binanceService: BinanceService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.BINANCE, binanceService, exchangeRegistry, dexService, liquidityOrderRepo);
  }
}
