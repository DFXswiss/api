import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../../../subdomains/supporting/dex/dex.module';
import { ExchangeModule } from '../../../integration/exchange/exchange.module';
import { DfiPricingDexService } from './services/dfi-pricing-dex.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './services/pricing.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetPricingMetadata } from './domain/entities/asset-pricing-metadata.entity';
import { AssetPricingMetadataRepository } from './repositories/asset-pricing-metadata.repository';
import { CoinGeckoService } from './services/coin-gecko.service';
import { PriceProviderService } from './services/price-provider.service';
import { PricingDeFiChainService } from './services/pricing-defichain.service';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';

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
    CoinGeckoService,
    PriceProviderService,
    PricingDeFiChainService,
    PricingService,
    DfiPricingDexService,
  ],
  exports: [PricingService, PriceProviderService],
})
export class PricingModule {}
