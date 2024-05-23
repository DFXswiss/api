import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class KrakenAdapter extends CcxtExchangeAdapter {
  constructor(
    krakenService: KrakenService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.KRAKEN, krakenService, exchangeRegistry, dexService, liquidityOrderRepo);
  }
}
