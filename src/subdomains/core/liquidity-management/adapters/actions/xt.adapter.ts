import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { XtService } from 'src/integration/exchange/services/xt.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class XtAdapter extends CcxtExchangeAdapter {
  constructor(
    xtService: XtService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.XT, xtService, exchangeRegistry, dexService, liquidityOrderRepo);
  }
}
