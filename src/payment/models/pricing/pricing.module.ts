import { Module } from '@nestjs/common';
import { DexModule } from '../dex/dex.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [ExchangeModule, DexModule],
  controllers: [],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
