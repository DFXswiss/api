import { Module } from '@nestjs/common';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { SharedModule } from 'src/shared/shared.module';
import { DexModule } from '../../../subdomains/supporting/dex/dex.module';
import { ExchangeModule } from '../../../integration/exchange/exchange.module';
import { DfiPricingDexService } from './services/dfi-pricing-dex.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [SharedModule, ExchangeModule, DexModule, NotificationModule],
  controllers: [PricingController],
  providers: [PricingService, DfiPricingDexService],
  exports: [PricingService],
})
export class PricingModule {}
