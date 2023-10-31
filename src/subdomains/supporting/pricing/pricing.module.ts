import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { SharedModule } from 'src/shared/shared.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { ExchangeModule } from '../../../integration/exchange/exchange.module';
import { DexModule } from '../../../subdomains/supporting/dex/dex.module';
import { AssetPricingMetadata } from './domain/entities/asset-pricing-metadata.entity';
import { PricingController } from './pricing.controller';
import { AssetPricingMetadataRepository } from './repositories/asset-pricing-metadata.repository';
import { AssetPricesService } from './services/asset-prices.service';
import { CoinGeckoService } from './services/integration/coin-gecko.service';
import { CurrencyService } from './services/integration/currency.service';
import { FixerService } from './services/integration/fixer.service';
import { PriceProviderDeFiChainService } from './services/integration/price-provider-defichain.service';
import { PricingCoinGeckoService } from './services/integration/pricing-coin-gecko.service';
import { PricingDeFiChainService } from './services/integration/pricing-defichain.service';
import { PriceProviderService } from './services/price-provider.service';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AssetPricingMetadata]),
    SharedModule,
    ExchangeModule,
    DexModule,
    NotificationModule,
    BlockchainModule,
  ],
  controllers: [PricingController],
  providers: [
    AssetPricingMetadataRepository,
    AssetPricesService,
    CoinGeckoService,
    FixerService,
    CurrencyService,
    PriceProviderService,
    PriceProviderDeFiChainService,
    PricingService,
    PricingDeFiChainService,
    PricingCoinGeckoService,
  ],
  exports: [PricingService, PriceProviderService],
})
export class PricingModule {}
