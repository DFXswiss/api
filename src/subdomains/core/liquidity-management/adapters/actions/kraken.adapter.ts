import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { LiquidityManagementOrderRepository } from '../../repositories/liquidity-management-order.repository';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class KrakenAdapter extends CcxtExchangeAdapter {
  protected readonly logger: DfxLoggerService;

  constructor(
    private readonly dfxLogger: DfxLoggerService,
    krakenService: KrakenService,
    exchangeRegistry: ExchangeRegistryService,
    dexService: DexService,
    liquidityOrderRepo: LiquidityManagementOrderRepository,
  ) {
    super(LiquidityManagementSystem.KRAKEN, krakenService, exchangeRegistry, dexService, liquidityOrderRepo);

    this.logger = this.dfxLogger.create(KrakenAdapter);
  }
}
