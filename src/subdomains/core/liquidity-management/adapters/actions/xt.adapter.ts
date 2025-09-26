import { Injectable } from '@nestjs/common';
import { ExchangeRegistryService } from 'src/integration/exchange/services/exchange-registry.service';
import { XtService } from 'src/integration/exchange/services/xt.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
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
    pricingService: PricingService,
    assetService: AssetService,
  ) {
    super(
      LiquidityManagementSystem.XT,
      xtService,
      exchangeRegistry,
      dexService,
      liquidityOrderRepo,
      pricingService,
      assetService,
    );
  }
}
