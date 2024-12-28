import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { ExchangeModule } from '../../../integration/exchange/exchange.module';
import { DexModule } from '../../../subdomains/supporting/dex/dex.module';
import { PriceRule } from './domain/entities/price-rule.entity';
import { PricingController } from './pricing.controller';
import { PriceRuleRepository } from './repositories/price-rule.repository';
import { AssetPricesService } from './services/asset-prices.service';
import { FiatPricesService } from './services/fiat-prices.service';
import { CoinGeckoService } from './services/integration/coin-gecko.service';
import { CurrencyService } from './services/integration/currency.service';
import { FixerService } from './services/integration/fixer.service';
import { PricingConstantService } from './services/integration/pricing-constant.service';
import { PricingDexService } from './services/integration/pricing-dex.service';
import { PricingEbel2xService } from './services/integration/pricing-ebel2x.service';
import { PricingFrankencoinService } from './services/integration/pricing-frankencoin.service';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceRule]),
    SharedModule,
    forwardRef(() => ExchangeModule),
    DexModule,
    NotificationModule,
    BlockchainModule,
  ],
  controllers: [PricingController],
  providers: [
    PriceRuleRepository,
    AssetPricesService,
    FiatPricesService,
    CoinGeckoService,
    FixerService,
    CurrencyService,
    PricingService,
    PricingDexService,
    PricingFrankencoinService,
    PricingEbel2xService,
    PricingConstantService,
  ],
  exports: [PricingService],
})
export class PricingModule {}
