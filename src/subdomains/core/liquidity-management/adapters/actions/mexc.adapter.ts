import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { MexcService } from 'src/integration/exchange/services/mexc.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class MexcAdapter extends CcxtExchangeAdapter {
  constructor(
    mexcService: MexcService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.MEXC, mexcService, exchangeRegistry, dexService, liquidityOrderRepo);
  }
}
