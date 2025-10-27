import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { MexcService } from 'src/integration/exchange/services/mexc.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
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
    pricingService: PricingService,
    assetService: AssetService,
  ) {
    super(
      LiquidityManagementSystem.MEXC,
      mexcService,
      exchangeRegistry,
      dexService,
      liquidityOrderRepo,
      pricingService,
      assetService,
    );
  }
}
