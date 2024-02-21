import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { ExchangeModule } from '../../../integration/exchange/exchange.module';
import { DexModule } from '../../../subdomains/supporting/dex/dex.module';
import { AssetPricingMetadata } from './domain/entities/asset-pricing-metadata.entity';
import { PriceRule } from './domain/entities/price-rule.entity';
import { PricingController } from './pricing.controller';
import { AssetPricingMetadataRepository } from './repositories/asset-pricing-metadata.repository';
import { PriceRuleRepository } from './repositories/price-rule.repository';
import { AssetPricesService } from './services/asset-prices.service';
import { FiatPricesService } from './services/fiat-prices.service';
import { CoinGeckoService } from './services/integration/coin-gecko.service';
import { CoinGeckoNewService } from './services/integration/coin-gecko.service.new';
import { CurrencyService } from './services/integration/currency.service';
import { FixerService } from './services/integration/fixer.service';
import { PricingCoinGeckoService } from './services/integration/pricing-coin-gecko.service';
import { PricingDexService } from './services/integration/pricing-dex.service';
import { PricingFrankencoinService } from './services/integration/pricing-frankencoin.service';
import { PriceProviderService } from './services/price-provider.service';
import { PricingService } from './services/pricing.service';
import { PricingServiceNew } from './services/pricing.service.new';

@Module({
  imports: [
    TypeOrmModule.forFeature([AssetPricingMetadata, PriceRule]),
    SharedModule,
    ExchangeModule,
    DexModule,
    NotificationModule,
    BlockchainModule,
  ],
  controllers: [PricingController],
  providers: [
    AssetPricingMetadataRepository,
    PriceRuleRepository,
    AssetPricesService,
    FiatPricesService,
    CoinGeckoService,
    CoinGeckoNewService,
    FixerService,
    CurrencyService,
    PriceProviderService,
    PricingService,
    PricingServiceNew,
    PricingCoinGeckoService,
    PricingDexService,
    PricingFrankencoinService,
  ],
  exports: [PricingService, PriceProviderService],
})
export class PricingModule {}
